/**
 * 録音が終わった面談を自動で議事録にする(interview-autopilot)ための判定規則。OSに依存しない。
 *
 * 定期実行(scripts/interview-autopilot.ts)が logs/interviews の録音を1つずつ見て、
 *   - 録り終わったか(停止の目印・録音の終了予定・プロセスの生死・ファイルが伸びていないか)
 *   - もう処理したか(状態ファイルに同じ大きさ・更新時刻で記録済みか)
 * を決める。ここは時刻と状態を引数で受ける純粋な関数だけにして、テストで決定的に確かめる。
 *
 * 録り終わりの目印(どれか):
 *   - <録音>.stop が置かれた(手で止めたとき。置けばすぐ処理の対象になる)
 *   - <録音>.recording.json(record-vac.ps1 が書く)の stopAfterIso を過ぎ、録音プロセスが居ない
 *   - 上のどちらも無い録音は、ファイルが quietMs 以上伸びていない
 * どの場合も、ファイルが settleMs 以上伸びていないことを確かめてから処理する(書き込み中を拾わない)。
 */
import { basename, extname } from 'node:path'

export const RECORDING_EXTENSIONS = new Set(['.wav', '.flac', '.mp3', '.m4a', '.mp4', '.webm', '.ogg'])

export const AUTOPILOT_DEFAULTS = {
  /** 書き込みが止まってから処理するまでの待ち */
  settleMs: 60_000,
  /** 目印の無い録音を「録り終わった」とみなす、伸びていない時間 */
  quietMs: 15 * 60_000,
  /** これより小さい録音は「ほぼ無音・録れていない」として処理しない */
  minBytes: 200 * 1024,
  /** 失敗した録音を試し直す回数の上限 */
  maxAttempts: 3,
  /** 失敗した録音を試し直すまでの間隔 */
  retryAfterMs: 30 * 60_000,
  /** 終了予定をこれだけ過ぎたら、録音プロセスが居るように見えても(PIDの再利用など)無視する */
  pidGraceMs: 30 * 60_000,
} as const

export type AutopilotOptions = Partial<typeof AUTOPILOT_DEFAULTS>

/** record-vac.ps1 が録音の隣に書く <録音>.recording.json */
export interface RecordingSidecar {
  appointmentId?: number
  careerMeetingId?: number
  startIso?: string
  endIso?: string
  /** 録音が自動で止まる時刻(終了予定 + 余裕) */
  stopAfterIso?: string
  /** 録音プロセス(ffmpeg)の PID */
  pid?: number
}

export interface RecordingCandidate {
  name: string
  path: string
  size: number
  mtimeMs: number
  sidecar?: RecordingSidecar
  stopMarker: boolean
  /** 録音プロセスが居るか。sidecar に PID が無ければ undefined */
  pidAlive?: boolean
}

export interface AutopilotEntry {
  size: number
  mtimeMs: number
  status: 'done' | 'failed' | 'skipped'
  attempts: number
  at: string
  reason?: string
  dbJsonPath?: string
}

export interface AutopilotState {
  schemaVersion: 1
  recordings: Record<string, AutopilotEntry>
}

export function emptyAutopilotState(): AutopilotState {
  return { schemaVersion: 1, recordings: {} }
}

export function parseAutopilotState(text: string | undefined): AutopilotState {
  if (!text?.trim()) return emptyAutopilotState()
  const value = JSON.parse(text) as Partial<AutopilotState>
  if (value.schemaVersion !== 1 || !value.recordings || typeof value.recordings !== 'object') throw new Error('状態ファイルの形が不正です')
  return { schemaVersion: 1, recordings: value.recordings }
}

/** 録音本体か。録り直しの断片(.part2.wav)や結合中の一時ファイルは対象にしない。 */
export function isRecordingFile(name: string): boolean {
  if (!RECORDING_EXTENSIONS.has(extname(name).toLowerCase())) return false
  return !/\.(part\d+|joining|tmp)\.[^.]+$/i.test(name) && !name.startsWith('.')
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

function validIso(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() && !Number.isNaN(Date.parse(value)) ? value.trim() : undefined
}

/** <録音>.recording.json を読む。読めない値は捨てる(録音そのものの処理は止めない)。 */
export function parseRecordingSidecar(text: string): RecordingSidecar {
  const value = JSON.parse(text.replace(/^﻿/, '')) as Record<string, unknown>
  const sidecar: RecordingSidecar = {}
  const appointmentId = positiveInt(value.appointmentId)
  const careerMeetingId = positiveInt(value.careerMeetingId)
  if (appointmentId) sidecar.appointmentId = appointmentId
  else if (careerMeetingId) sidecar.careerMeetingId = careerMeetingId
  for (const key of ['startIso', 'endIso', 'stopAfterIso'] as const) {
    const iso = validIso(value[key])
    if (iso) sidecar[key] = iso
  }
  const pid = positiveInt(value.pid)
  if (pid) sidecar.pid = pid
  return sidecar
}

/** 録り終わったか。 */
export function recordingFinished(candidate: RecordingCandidate, now: number, options: AutopilotOptions = {}): { finished: boolean; reason: string } {
  const settleMs = options.settleMs ?? AUTOPILOT_DEFAULTS.settleMs
  const quietMs = options.quietMs ?? AUTOPILOT_DEFAULTS.quietMs
  const pidGraceMs = options.pidGraceMs ?? AUTOPILOT_DEFAULTS.pidGraceMs
  const quiet = now - candidate.mtimeMs
  const stopAfter = candidate.sidecar?.stopAfterIso ? Date.parse(candidate.sidecar.stopAfterIso) : undefined
  if (candidate.pidAlive && !(stopAfter !== undefined && now >= stopAfter + pidGraceMs)) {
    return { finished: false, reason: '録音プロセスが動いている' }
  }
  if (quiet < settleMs) return { finished: false, reason: '書き込みが続いている' }
  if (candidate.stopMarker) return { finished: true, reason: '停止の目印がある' }
  if (candidate.pidAlive === false) return { finished: true, reason: '録音プロセスが終わった' }
  if (stopAfter !== undefined) {
    return now >= stopAfter ? { finished: true, reason: '録音の終了予定を過ぎた' } : { finished: false, reason: '録音の終了予定より前' }
  }
  return quiet >= quietMs
    ? { finished: true, reason: `${Math.round(quietMs / 60_000)}分以上伸びていない` }
    : { finished: false, reason: '目印が無く、まだ伸びる可能性がある' }
}

export type AutopilotAction = 'process' | 'wait' | 'skip' | 'too-small'

/** この録音をいま処理するか。同じ大きさ・更新時刻で処理済みなら二度と処理しない(冪等)。 */
export function decideRecording(
  candidate: RecordingCandidate,
  entry: AutopilotEntry | undefined,
  now: number,
  options: AutopilotOptions = {},
): { action: AutopilotAction; reason: string } {
  const minBytes = options.minBytes ?? AUTOPILOT_DEFAULTS.minBytes
  const maxAttempts = options.maxAttempts ?? AUTOPILOT_DEFAULTS.maxAttempts
  const retryAfterMs = options.retryAfterMs ?? AUTOPILOT_DEFAULTS.retryAfterMs
  const same = entry && entry.size === candidate.size && entry.mtimeMs === candidate.mtimeMs
  if (same && entry.status === 'done') return { action: 'skip', reason: '処理済み' }
  if (same && entry.status === 'skipped') return { action: 'skip', reason: entry.reason || '対象外として記録済み' }
  const finished = recordingFinished(candidate, now, options)
  if (!finished.finished) return { action: 'wait', reason: finished.reason }
  if (candidate.size < minBytes) return { action: 'too-small', reason: `録音が小さすぎる(${Math.round(candidate.size / 1024)}KB)` }
  if (same && entry.status === 'failed') {
    if (entry.attempts >= maxAttempts) return { action: 'skip', reason: `失敗が${entry.attempts}回続いたため止めている(手で直してから状態を消す)` }
    if (now - Date.parse(entry.at) < retryAfterMs) return { action: 'wait', reason: '前回の失敗から間を置いている' }
  }
  return { action: 'process', reason: finished.reason }
}

export type AutopilotMode = 'apply' | 'bundle' | 'minutes'

/** interview:digest に渡す引数。予定IDと開始時刻は録音の隣の記録から渡す(モデルに推測させない)。 */
export function digestArguments(candidate: RecordingCandidate, mode: AutopilotMode, extra: { agent?: string; backend?: string; speakers?: boolean; db?: string } = {}): string[] {
  const args = [candidate.path]
  const sidecar = candidate.sidecar
  if (sidecar?.appointmentId) args.push('--appointment', String(sidecar.appointmentId))
  else if (sidecar?.careerMeetingId) args.push('--career-meeting', String(sidecar.careerMeetingId))
  if (sidecar?.startIso) args.push('--occurred-at', sidecar.startIso)
  if (extra.backend) args.push('--backend', extra.backend)
  if (extra.speakers) args.push('--speakers')
  if (extra.agent) args.push('--agent', extra.agent)
  if (mode === 'apply') {
    args.push('--apply')
    if (extra.db) args.push('--db', extra.db)
  }
  return args
}

/** 処理の結果を状態へ書く。失敗は回数を数える(同じ録音の失敗だけ)。 */
export function recordOutcome(
  state: AutopilotState,
  candidate: RecordingCandidate,
  status: AutopilotEntry['status'],
  now: Date,
  extra: { reason?: string; dbJsonPath?: string } = {},
): AutopilotEntry {
  const previous = state.recordings[candidate.name]
  const same = previous && previous.size === candidate.size && previous.mtimeMs === candidate.mtimeMs
  const entry: AutopilotEntry = {
    size: candidate.size,
    mtimeMs: candidate.mtimeMs,
    status,
    attempts: (same ? previous.attempts : 0) + (status === 'skipped' ? 0 : 1),
    at: now.toISOString(),
  }
  if (extra.reason) entry.reason = extra.reason
  if (extra.dbJsonPath) entry.dbJsonPath = extra.dbJsonPath
  state.recordings[candidate.name] = entry
  return entry
}

/** 録音の stem(拡張子なし)。-shots・-db.json・バンドル名はこれから決まる。 */
export function recordingStem(path: string): string {
  return basename(path, extname(path))
}
