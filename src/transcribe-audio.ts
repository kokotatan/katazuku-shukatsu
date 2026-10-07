/**
 * 録音ファイル(音声・動画)を文字起こしの全文テキストにする実行部分。
 * 計算と通信の規則は src/transcription.ts、ここは ffmpeg・Python・voicebox の起動とファイルI/Oだけを持つ。
 *
 *   npm run transcribe -- <録音> [--backend auto|voicebox|faster-whisper] [--speakers] [--out <txt>]
 *
 * 流れと前提は docs/TRANSCRIPTION.md。録音と文字起こしは個人情報なので、出力は既定で
 * gitignore 済みの logs/interviews/ に置く。
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { repositoryRoot } from './database-path.js'
import {
  CHUNK_SECONDS,
  mergeSpeakerSegments,
  parseChannelCount,
  parseWhisperSegments,
  renderChunkTranscript,
  renderSegmentTranscript,
  sameTranscriptReceipt,
  selectTranscriptionBackend,
  sortChunkFiles,
  SPEAKER_LABELS,
  VOICEBOX_DEFAULT_MCP_URL,
  VOICEBOX_STARTUP_WAIT_MS,
  VoiceboxMcpClient,
  waitUntil,
  type TranscriptionBackend,
  type TranscriptionBackendRequest,
  type TranscriptReceipt,
  type TranscriptSegment,
} from './transcription.js'

export interface TranscribeAudioOptions {
  input: string
  /** 出力する全文テキスト。省略時は <リポジトリ>/logs/interviews/<元の名前>-transcript.txt */
  output?: string
  backend?: TranscriptionBackendRequest
  /** ステレオ録音を左右別に文字起こしし、[相手] / [本人] を付ける(faster-whisper のみ) */
  speakers?: boolean
  /** 同じ元ファイルの文字起こしがあっても作り直す */
  force?: boolean
  /** 分割した音声などの中間ファイルを残す */
  keepWork?: boolean
  env?: NodeJS.ProcessEnv
  root?: string
  log?: (line: string) => void
}

export interface TranscribeAudioResult {
  output: string
  backend: TranscriptionBackend
  reused: boolean
  chunks?: number
  silent?: number
  segments?: number
}

export function defaultTranscriptPath(input: string, root: string = repositoryRoot()): string {
  const stem = basename(input, extname(input))
  return join(root, 'logs', 'interviews', `${stem}-transcript.txt`)
}

function run(command: string, args: string[], options: { stderr?: 'pipe' | 'inherit' } = {}): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
    stdio: ['ignore', 'pipe', options.stderr ?? 'pipe'],
  })
  return { ok: result.status === 0 && !result.error, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

/** ffmpeg を探す。KATAZUKU_FFMPEG > PATH > winget の置き場(インストール直後は PATH が古いことがある)。 */
export function findFfmpeg(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.KATAZUKU_FFMPEG) return env.KATAZUKU_FFMPEG
  if (run('ffmpeg', ['-hide_banner', '-version']).ok) return 'ffmpeg'
  if (process.platform !== 'win32' || !env.LOCALAPPDATA) return undefined
  const links = join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe')
  if (existsSync(links)) return links
  const packages = join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages')
  if (!existsSync(packages)) return undefined
  for (const pkg of readdirSync(packages).filter((name) => /ffmpeg/i.test(name))) {
    const base = join(packages, pkg)
    for (const build of readdirSync(base)) {
      const candidate = join(base, build, 'bin', 'ffmpeg.exe')
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}

function ffprobeFor(ffmpeg: string): string {
  if (ffmpeg === 'ffmpeg') return 'ffprobe'
  const name = basename(ffmpeg).replace(/ffmpeg/i, 'ffprobe')
  const sibling = join(dirname(ffmpeg), name)
  return existsSync(sibling) ? sibling : 'ffprobe'
}

function pythonCommand(env: NodeJS.ProcessEnv): string {
  return env.KATAZUKU_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
}

export function fasterWhisperAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return run(pythonCommand(env), ['-c', 'import faster_whisper']).ok
}

/** voicebox の起動コマンド。KATAZUKU_VOICEBOX_COMMAND > Windows の既定のインストール先。 */
export function voiceboxCommand(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.KATAZUKU_VOICEBOX_COMMAND) return env.KATAZUKU_VOICEBOX_COMMAND
  if (process.platform !== 'win32') return undefined
  return [env.ProgramFiles, env['ProgramFiles(x86)']]
    .filter((dir): dir is string => Boolean(dir))
    .map((dir) => join(dir, 'Voicebox', 'voicebox.exe'))
    .find((path) => existsSync(path))
}

export function voiceboxUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.KATAZUKU_VOICEBOX_MCP_URL || VOICEBOX_DEFAULT_MCP_URL
}

/** URL のホスト・ポートへ TCP で繋がるか(MCPの初期化はせず、待ち受けているかだけを見る)。 */
export function isPortOpen(url: string, timeoutMs = 1500): Promise<boolean> {
  const parsed = new URL(url)
  const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80))
  return new Promise((resolvePromise) => {
    const socket = connect({ host: parsed.hostname, port })
    const done = (ok: boolean) => {
      socket.destroy()
      resolvePromise(ok)
    }
    socket.setTimeout(timeoutMs, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

function startDetached(command: string): void {
  const child = spawn(command, [], { detached: true, stdio: 'ignore', windowsHide: true })
  child.on('error', () => {})
  child.unref()
}

function ffmpegOrThrow(env: NodeJS.ProcessEnv): string {
  const ffmpeg = findFfmpeg(env)
  if (!ffmpeg) throw new Error('ffmpeg が見つかりません(Windows: winget install Gyan.FFmpeg / macOS: brew install ffmpeg。KATAZUKU_FFMPEG で指定もできる)')
  return ffmpeg
}

function extractMono(ffmpeg: string, input: string, output: string, channel?: 0 | 1): void {
  const filter = channel === undefined ? ['-ac', '1'] : ['-af', `pan=mono|c0=c${channel}`]
  const result = run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-vn', ...filter, '-ar', '16000', output])
  if (!result.ok || !existsSync(output)) throw new Error(`ffmpeg で音声を取り出せませんでした: ${result.stderr.slice(-300)}`)
}

async function transcribeWithVoicebox(ffmpeg: string, input: string, workDir: string, env: NodeJS.ProcessEnv, log: (line: string) => void) {
  const chunkDir = join(workDir, 'chunks')
  mkdirSync(chunkDir, { recursive: true })
  // 動画からの取り出し・16kHzモノラル化・30秒分割を1回の ffmpeg で済ませる
  const split = run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000',
    '-f', 'segment', '-segment_time', String(CHUNK_SECONDS), join(chunkDir, 'c-%03d.wav'),
  ])
  if (!split.ok) throw new Error(`ffmpeg で30秒ごとに分割できませんでした: ${split.stderr.slice(-300)}`)
  const chunks = sortChunkFiles(readdirSync(chunkDir))
  if (!chunks.length) throw new Error('分割した音声が1つもありません(録音が空の可能性)')
  log(`${chunks.length}個(${CHUNK_SECONDS}秒ごと)に分割しました`)
  const client = new VoiceboxMcpClient({ url: voiceboxUrl(env) })
  await client.initialize()
  const texts: string[] = []
  for (const [index, chunk] of chunks.entries()) {
    const text = await client.transcribe(resolve(chunkDir, chunk))
    texts.push(text)
    log(`${index + 1}/${chunks.length}: ${text ? `${text.length}文字` : '[無音]'}`)
  }
  const rendered = renderChunkTranscript(texts)
  return { text: rendered.text, chunks: chunks.length, silent: rendered.silent }
}

function whisperSegments(audio: string, env: NodeJS.ProcessEnv, root: string): TranscriptSegment[] {
  const script = join(root, 'scripts', 'faster-whisper-transcribe.py')
  const result = run(pythonCommand(env), [script, audio], { stderr: 'inherit' })
  if (!result.ok) throw new Error('faster-whisper での文字起こしに失敗しました(上の出力を確認)')
  return parseWhisperSegments(result.stdout)
}

function transcribeWithWhisper(
  ffmpeg: string, input: string, workDir: string, speakers: boolean, env: NodeJS.ProcessEnv, root: string, log: (line: string) => void,
) {
  if (speakers) {
    const probe = run(ffprobeFor(ffmpeg), ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=channels', '-of', 'csv=p=0', input])
    if (!probe.ok) throw new Error('ffprobe でチャンネル数を確かめられませんでした(話者分離には ffprobe が要る)')
    const channels = parseChannelCount(probe.stdout)
    if (channels < 2) throw new Error(`話者分離にはステレオ録音(L=相手 / R=本人)が要ります。この録音は${channels}chです(--speakers を外すとモノラルで文字起こしできる)`)
    const left = join(workDir, 'left.wav')
    const right = join(workDir, 'right.wav')
    extractMono(ffmpeg, input, left, 0)
    extractMono(ffmpeg, input, right, 1)
    log(`左(${SPEAKER_LABELS.left})を文字起こし中`)
    const leftSegments = whisperSegments(left, env, root)
    log(`右(${SPEAKER_LABELS.right})を文字起こし中`)
    const rightSegments = whisperSegments(right, env, root)
    const merged = mergeSpeakerSegments([
      { speaker: SPEAKER_LABELS.left, segments: leftSegments },
      { speaker: SPEAKER_LABELS.right, segments: rightSegments },
    ])
    return { text: renderSegmentTranscript(merged), segments: merged.length }
  }
  const mono = join(workDir, 'mono.wav')
  extractMono(ffmpeg, input, mono)
  const segments = mergeSpeakerSegments([{ segments: whisperSegments(mono, env, root) }])
  return { text: renderSegmentTranscript(segments), segments: segments.length }
}

/**
 * 録音を文字起こしし、全文テキストを書き出す。
 * 同じ元ファイル・同じ方式の文字起こしが既にあれば、作り直さずに再利用する(force で作り直す)。
 */
export async function transcribeAudio(options: TranscribeAudioOptions): Promise<TranscribeAudioResult> {
  const env = options.env ?? process.env
  const root = options.root ?? repositoryRoot()
  const log = options.log ?? ((line: string) => console.error(line))
  const input = resolve(options.input)
  if (!existsSync(input) || !statSync(input).isFile()) throw new Error(`録音ファイルがありません: ${input}`)
  const output = resolve(options.output ?? defaultTranscriptPath(input, root))
  const speakers = Boolean(options.speakers)
  const url = voiceboxUrl(env)

  const reachable = await isPortOpen(url)
  const launcher = reachable ? undefined : voiceboxCommand(env)
  const choice = selectTranscriptionBackend(options.backend ?? 'auto', {
    voiceboxReachable: reachable,
    voiceboxLaunchable: Boolean(launcher),
    // voicebox が既に使えるなら Python を起動して確かめるまでもない
    fasterWhisper: reachable && !speakers && options.backend !== 'faster-whisper' ? false : fasterWhisperAvailable(env),
  }, { speakers })

  const stat = statSync(input)
  const receipt: TranscriptReceipt = { source: input, bytes: stat.size, modifiedMs: Math.trunc(stat.mtimeMs), backend: choice.backend, speakers }
  const receiptPath = `${output}.source.json`
  if (!options.force && existsSync(output) && existsSync(receiptPath)) {
    try {
      if (sameTranscriptReceipt(JSON.parse(readFileSync(receiptPath, 'utf8')), receipt)) {
        log(`同じ録音の文字起こしがあるので再利用します: ${output}`)
        return { output, backend: choice.backend, reused: true }
      }
    } catch {
      // 壊れた受領票は無視して作り直す
    }
  }

  if (choice.startVoicebox && launcher) {
    log(`voicebox を起動します(最大${VOICEBOX_STARTUP_WAIT_MS / 1000}秒待つ)`)
    startDetached(launcher)
    const up = await waitUntil(() => isPortOpen(url), { timeoutMs: VOICEBOX_STARTUP_WAIT_MS, intervalMs: 2000 })
    if (!up) throw new Error(`voicebox が${VOICEBOX_STARTUP_WAIT_MS / 1000}秒以内に ${url} で待ち受けませんでした。手で起動してから再実行してください`)
    log('voicebox が起動しました')
  }

  const ffmpeg = ffmpegOrThrow(env)
  mkdirSync(dirname(output), { recursive: true })
  const workDir = `${output.replace(/\.txt$/i, '')}-work`
  rmSync(workDir, { recursive: true, force: true })
  mkdirSync(workDir, { recursive: true })
  try {
    log(`文字起こし方式: ${choice.backend}${speakers ? '(左右別・話者ラベル付き)' : ''}`)
    const result = choice.backend === 'voicebox'
      ? await transcribeWithVoicebox(ffmpeg, input, workDir, env, log)
      : transcribeWithWhisper(ffmpeg, input, workDir, speakers, env, root, log)
    writeFileSync(output, result.text, 'utf8')
    writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), 'utf8')
    return { output, backend: choice.backend, reused: false, ...('chunks' in result ? { chunks: result.chunks, silent: result.silent } : { segments: result.segments }) }
  } finally {
    // 中間の音声は個人情報の複製なので、成否にかかわらず既定で消す
    if (!options.keepWork) rmSync(workDir, { recursive: true, force: true })
  }
}
