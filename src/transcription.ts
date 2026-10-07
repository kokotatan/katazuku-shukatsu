/**
 * 録音の文字起こしで使う、決定的な部品(I/Oを持たない計算と、注入可能な通信)。
 *
 * 文字起こしはLLMのツール呼び出しに任せず、スクリプトが決定的に済ませる。
 * provider によっては非対話の実行でMCPツール呼び出しを自動で拒否するため、
 * 「議事録化の provider を切り替えたら文字起こしごと止まる」ことが起きる。
 * ここで全文を作っておけば、後段のエージェントは文字列を読むだけでよい。
 *
 * 2つの方式を持つ:
 * - voicebox: ローカルの Voicebox を MCP(streamable HTTP)で呼ぶ。
 *   1回の要求で先頭30秒の窓しか復号しないのに全体の長さを返すため、長い録音を渡すと
 *   「冒頭30秒だけの文字起こし」がエラーなしで返る。必ず30秒ごとに分割して順に渡す。
 * - faster-whisper: 任意導入の Python 実装(scripts/faster-whisper-transcribe.py)。
 *   発話ごとの時刻が取れるので、ステレオ録音(L=相手 / R=本人)を左右別に文字起こしし、
 *   時刻順に合流させると話者ラベルが音響的に確定する。
 */

export type TranscriptionBackend = 'voicebox' | 'faster-whisper'
export type TranscriptionBackendRequest = TranscriptionBackend | 'auto'

/** voicebox へ1回に渡す長さ(秒)。これより長いと冒頭だけが文字起こしされる。 */
export const CHUNK_SECONDS = 30
export const VOICEBOX_DEFAULT_MCP_URL = 'http://127.0.0.1:17493/mcp'
/**
 * voicebox の起動待ち。冷えた状態からは本体 → サーバ → ワーカーの順に立ち上がり、
 * ポートが開くまで90秒前後かかる。60秒では直前で諦めたことがあるため余裕を持たせる。
 */
export const VOICEBOX_STARTUP_WAIT_MS = 240_000
export const SILENT_MARK = '[無音]'
/** ステレオ録音の話者ラベル。録音側(scripts/record-vac.ps1 -Stereo)は L=相手 / R=本人 で残す。 */
export const SPEAKER_LABELS = { left: '相手', right: '本人' } as const

/** 録音内の経過秒を `mm:ss` にする。60分を超えても分を繰り上げない(`75:30`)。 */
export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(total / 60)
  return `${String(minutes).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/**
 * ffmpeg の segment 出力(`c-000.wav` ...)を番号順に並べる。
 * 3桁を超える番号(`c-1000.wav`)も落とさず、文字列順ではなく数値順にする。
 */
export function sortChunkFiles(names: string[]): string[] {
  return names
    .map((name) => ({ name, match: /^c-(\d+)\.wav$/i.exec(name) }))
    .filter((item): item is { name: string; match: RegExpExecArray } => item.match !== null)
    .sort((a, b) => Number(a.match[1]) - Number(b.match[1]))
    .map((item) => item.name)
}

/**
 * チャンクごとの文字起こしを、30秒ごとの `[mm:ss]` 見出し付きの全文にする。
 * 空のチャンクは `[mm:ss] [無音]` の1行にする(消さない。時刻の対応を崩さないため)。
 */
export function renderChunkTranscript(texts: string[], chunkSeconds = CHUNK_SECONDS): { text: string; silent: number } {
  const lines: string[] = []
  let silent = 0
  texts.forEach((raw, index) => {
    const stamp = formatTimestamp(index * chunkSeconds)
    const text = raw.trim()
    if (!text) {
      silent += 1
      lines.push(`[${stamp}] ${SILENT_MARK}`)
    } else {
      lines.push(`[${stamp}]`, text, '')
    }
  })
  return { text: lines.join('\n').replace(/\n+$/, '') + '\n', silent }
}

export interface TranscriptSegment {
  /** 録音先頭からの秒 */
  start: number
  end: number
  text: string
  speaker?: string
}

export interface SpeakerTrack {
  speaker?: string
  segments: TranscriptSegment[]
}

/**
 * 話者ごと(左右のチャンネルごと)の発話を、開始時刻順に1本へ合流させる。
 * 同時刻の発話は渡されたトラックの順(相手 → 本人)を保つ。空の発話は捨てる。
 */
export function mergeSpeakerSegments(tracks: SpeakerTrack[]): TranscriptSegment[] {
  const items: { segment: TranscriptSegment; track: number; order: number }[] = []
  tracks.forEach((track, trackIndex) => {
    track.segments.forEach((segment, order) => {
      const text = segment.text.trim()
      if (!text || !Number.isFinite(segment.start)) return
      items.push({
        segment: { ...segment, text, ...(track.speaker ? { speaker: track.speaker } : {}) },
        track: trackIndex,
        order,
      })
    })
  })
  items.sort((a, b) => a.segment.start - b.segment.start || a.track - b.track || a.order - b.order)
  return items.map((item) => item.segment)
}

/** 発話の列を `[mm:ss] [話者] 本文` の行にする。発話が1つも無ければ `[00:00] [無音]`。 */
export function renderSegmentTranscript(segments: TranscriptSegment[]): string {
  if (!segments.length) return `[00:00] ${SILENT_MARK}\n`
  return segments
    .map((segment) => `[${formatTimestamp(segment.start)}]${segment.speaker ? ` [${segment.speaker}]` : ''} ${segment.text}`)
    .join('\n') + '\n'
}

/** faster-whisper 補助スクリプトの出力(JSON)を検査して発話の列にする。 */
export function parseWhisperSegments(output: string): TranscriptSegment[] {
  const value = JSON.parse(output.trim().split(/\r?\n/).pop() ?? '') as { segments?: unknown }
  if (!value || !Array.isArray(value.segments)) throw new Error('faster-whisper の出力に segments がありません')
  return value.segments.map((item, index) => {
    const segment = item as Partial<TranscriptSegment>
    if (typeof segment.start !== 'number' || typeof segment.end !== 'number' || typeof segment.text !== 'string') {
      throw new Error(`faster-whisper の出力の ${index} 番目の発話が不正です`)
    }
    return { start: segment.start, end: segment.end, text: segment.text }
  })
}

/** ffprobe の `-show_entries stream=channels -of csv=p=0` の出力から最大チャンネル数を読む。 */
export function parseChannelCount(output: string): number {
  const counts = output.split(/\r?\n/).map((line) => Number.parseInt(line.trim(), 10)).filter((value) => Number.isFinite(value))
  return counts.length ? Math.max(...counts) : 0
}

export interface BackendAvailability {
  /** voicebox のポートが既に開いている */
  voiceboxReachable: boolean
  /** voicebox が止まっているが、起動コマンドが分かっている */
  voiceboxLaunchable: boolean
  /** Python から faster_whisper を import できる */
  fasterWhisper: boolean
}

export interface BackendChoice {
  backend: TranscriptionBackend
  /** voicebox を起動してからポートが開くのを待つ必要がある */
  startVoicebox: boolean
}

/**
 * 文字起こしの方式を決める。
 * - 明示指定はその方式だけを使い、使えなければ理由つきで止める(黙って別方式へ切り替えない)。
 * - auto は「すぐ使えるもの」を優先する: 起動済みの voicebox → faster-whisper → voicebox を起動して待つ。
 * - 話者分離(左右別の文字起こし)は発話ごとの時刻が要るので faster-whisper だけが対応する。
 */
export function selectTranscriptionBackend(
  request: TranscriptionBackendRequest,
  availability: BackendAvailability,
  options: { speakers?: boolean } = {},
): BackendChoice {
  const voicebox = (): BackendChoice => {
    if (availability.voiceboxReachable) return { backend: 'voicebox', startVoicebox: false }
    if (availability.voiceboxLaunchable) return { backend: 'voicebox', startVoicebox: true }
    throw new Error('voicebox が起動しておらず、起動コマンドも見つかりません(KATAZUKU_VOICEBOX_COMMAND で指定できます)')
  }
  const whisper = (): BackendChoice => {
    if (availability.fasterWhisper) return { backend: 'faster-whisper', startVoicebox: false }
    throw new Error('faster-whisper が使えません(pip install faster-whisper。Python は KATAZUKU_PYTHON で指定できます)')
  }
  if (options.speakers) {
    if (request === 'voicebox') throw new Error('話者分離(--speakers)は faster-whisper でだけ使えます')
    return whisper()
  }
  if (request === 'voicebox') return voicebox()
  if (request === 'faster-whisper') return whisper()
  if (request !== 'auto') throw new Error(`未知の文字起こし方式です: ${String(request)}`)
  if (availability.voiceboxReachable) return { backend: 'voicebox', startVoicebox: false }
  if (availability.fasterWhisper) return { backend: 'faster-whisper', startVoicebox: false }
  if (availability.voiceboxLaunchable) return { backend: 'voicebox', startVoicebox: true }
  throw new Error('使える文字起こし方式がありません。voicebox を起動するか、faster-whisper を入れてください(docs/TRANSCRIPTION.md)')
}

export interface WaitOptions {
  timeoutMs: number
  intervalMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/**
 * probe が true を返すまで待つ。期限を過ぎたら最後にもう一度だけ確かめて false を返す。
 * 時計と sleep を注入できるので、テストでは実時間を待たない。
 */
export async function waitUntil(probe: () => Promise<boolean>, options: WaitOptions): Promise<boolean> {
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const interval = options.intervalMs ?? 2000
  const deadline = now() + options.timeoutMs
  while (now() < deadline) {
    if (await probe()) return true
    await sleep(Math.min(interval, Math.max(0, deadline - now())))
  }
  return probe()
}

/** 文字起こし済みの全文を再利用してよいか(同じ元ファイル・同じ方式なら高い処理をやり直さない)。 */
export interface TranscriptReceipt {
  source: string
  bytes: number
  modifiedMs: number
  backend: TranscriptionBackend
  speakers: boolean
}

export function sameTranscriptReceipt(previous: unknown, current: TranscriptReceipt): boolean {
  if (!previous || typeof previous !== 'object') return false
  const value = previous as Partial<TranscriptReceipt>
  return value.source === current.source && value.bytes === current.bytes && value.modifiedMs === current.modifiedMs &&
    value.backend === current.backend && Boolean(value.speakers) === current.speakers
}

// ---------------------------------------------------------------- voicebox MCP

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  text(): Promise<string>
}>

/** streamable HTTP の応答は SSE(`data: {...}`)とプレーンJSONのどちらもありうる。 */
export function parseMcpBody(text: string): unknown {
  const lines = text.split(/\r?\n/).filter((line) => line.startsWith('data:'))
  if (lines.length) return JSON.parse(lines[lines.length - 1].slice(5).trim())
  return JSON.parse(text)
}

/** voicebox.transcribe の tools/call 応答から本文を取り出す。 */
export function parseVoiceboxTranscribeResult(body: unknown): string {
  const value = body as { error?: unknown; result?: { content?: { text?: unknown }[]; isError?: boolean } } | null
  if (value?.error) throw new Error(`voicebox.transcribe が失敗しました: ${JSON.stringify(value.error).slice(0, 200)}`)
  const content = value?.result?.content?.[0]?.text
  if (typeof content !== 'string') throw new Error(`voicebox.transcribe の応答形式が想定外です: ${JSON.stringify(body).slice(0, 200)}`)
  if (value?.result?.isError) throw new Error(`voicebox.transcribe が失敗しました: ${content.slice(0, 200)}`)
  const parsed = JSON.parse(content) as { text?: unknown }
  if (typeof parsed?.text !== 'string') throw new Error(`voicebox.transcribe の応答に text がありません: ${content.slice(0, 200)}`)
  return parsed.text.trim()
}

export interface VoiceboxClientOptions {
  url?: string
  language?: string
  model?: string
  fetch?: FetchLike
  /** 1チャンクあたりの試行回数 */
  attempts?: number
  retryDelayMs?: number
  sleep?: (ms: number) => Promise<void>
}

/** voicebox の MCP を直接叩く最小のクライアント(SDKに依存しない)。 */
export class VoiceboxMcpClient {
  private sessionId: string | null = null
  private nextId = 1
  private readonly url: string
  private readonly fetcher: FetchLike
  private readonly sleep: (ms: number) => Promise<void>
  private readonly options: VoiceboxClientOptions

  constructor(options: VoiceboxClientOptions = {}) {
    this.options = options
    this.url = options.url ?? VOICEBOX_DEFAULT_MCP_URL
    this.fetcher = options.fetch ?? (globalThis.fetch as unknown as FetchLike)
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  private async rpc(payload: Record<string, unknown>): Promise<unknown> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId
    const response = await this.fetcher(this.url, { method: 'POST', headers, body: JSON.stringify(payload) })
    const session = response.headers.get('mcp-session-id')
    if (session) this.sessionId = session
    const text = await response.text()
    if (!response.ok) throw new Error(`voicebox MCP が HTTP ${response.status} を返しました: ${text.slice(0, 200)}`)
    return text ? parseMcpBody(text) : null
  }

  async initialize(): Promise<void> {
    const init = await this.rpc({
      jsonrpc: '2.0', id: this.nextId++, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'katazuku-transcribe', version: '1' } },
    }) as { error?: unknown } | null
    if (init?.error) throw new Error(`voicebox MCP の initialize が失敗しました: ${JSON.stringify(init.error).slice(0, 200)}`)
    await this.rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })
  }

  /** 1チャンクを文字起こしする。一時的な失敗は attempts 回まで間をおいて再試行する。 */
  async transcribe(audioPath: string): Promise<string> {
    const attempts = this.options.attempts ?? 3
    let lastError: unknown
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const body = await this.rpc({
          jsonrpc: '2.0', id: this.nextId++, method: 'tools/call',
          params: {
            name: 'voicebox.transcribe',
            arguments: { audio_path: audioPath, language: this.options.language ?? 'ja', model: this.options.model ?? 'turbo' },
          },
        })
        return parseVoiceboxTranscribeResult(body)
      } catch (error) {
        lastError = error
        if (attempt + 1 < attempts) await this.sleep(this.options.retryDelayMs ?? 2000)
      }
    }
    throw new Error(`${attempts}回試しても文字起こしできませんでした: ${String((lastError as Error)?.message ?? lastError)}`)
  }
}
