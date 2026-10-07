/**
 * 録音が終わった面談を見つけて、議事録にする(定期実行の1回分)。
 *
 *   npm run interview:autopilot -- [--apply [--db <path>] | --bundle] [--dir <録音の置き場>] [--max <件数>]
 *       [--agent <provider>] [--backend auto|voicebox|faster-whisper] [--speakers] [--no-faces] [--dry-run]
 *
 * 1回の実行で、録り終わった録音を古い順に最大 --max 件(既定1)処理する:
 *   1. npm run interview:digest -- <録音> [--appointment <ID>] [--occurred-at <開始>] [--apply]
 *      予定ID・開始時刻は record-vac.ps1 が録音の隣に書く <録音>.recording.json から渡す
 *   2. <録音>-shots があれば npm run interview:faces -- detect で顔写真の候補を切り出す(検出器が無ければ飛ばす)。
 *      誰の顔かは本人が書くまで付けない(docs/TRANSCRIPTION.md「顔写真」)
 *   3. --bundle なら scripts/new-interview-bundle.ps1 で面談バンドルを作る(正本DBが別の機械のとき)
 *
 * - 二重起動はロック(logs/interview-autopilot.lock)で防ぐ。固まった前回のロックは6時間で回収する
 * - 処理済みの録音は logs/interview-autopilot-state.json に大きさと更新時刻で記録し、二度と処理しない
 * - 経過は logs/interview-autopilot.log、結果は活動ログ(logs/activity-log.jsonl)、失敗は logs/alert-interview-autopilot.txt
 * - 何も外部へ送らない。議事録化の provider は interview:digest と同じ(設定ファイルの順)
 *
 * 定期実行の登録は scripts/register-interview-autopilot.ps1(Windows)。cron / launchd は docs/TRANSCRIPTION.md。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, appendFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { repositoryRoot } from '../src/database-path.js'
import {
  decideRecording,
  digestArguments,
  isRecordingFile,
  parseAutopilotState,
  parseRecordingSidecar,
  recordingStem,
  recordOutcome,
  type AutopilotMode,
  type RecordingCandidate,
} from '../src/interview-autopilot.js'
import { acquireLock, appendActivity, clearAlert, logsDir, recordAlert } from '../src/workflow-support.js'

const ROOT = repositoryRoot()
const NAME = 'interview-autopilot'
const USAGE = '使い方: npm run interview:autopilot -- [--apply [--db <path>] | --bundle] [--dir <dir>] [--max <件数>] [--agent <provider>] [--backend <方式>] [--speakers] [--no-faces] [--dry-run]'

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

let parsed
try {
  parsed = parseArgs({
    options: {
      apply: { type: 'boolean', default: false },
      bundle: { type: 'boolean', default: false },
      db: { type: 'string' },
      dir: { type: 'string' },
      max: { type: 'string', default: '1' },
      agent: { type: 'string' },
      backend: { type: 'string' },
      speakers: { type: 'boolean', default: false },
      'no-faces': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
    },
  })
} catch (error) {
  fail(`${(error as Error).message}\n${USAGE}`)
}
const values = parsed.values
if (values.apply && values.bundle) fail('--apply と --bundle は同時に指定できません')
if (values.db && !values.apply) fail('--db は --apply と一緒に指定します')
const max = Number(values.max)
if (!Number.isInteger(max) || max < 1) fail(`--max は1以上の整数です: ${values.max}`)
const mode: AutopilotMode = values.apply ? 'apply' : values.bundle ? 'bundle' : 'minutes'
const dir = resolve(values.dir ?? join(ROOT, 'logs', 'interviews'))
const logFile = join(ROOT, 'logs', `${NAME}.log`)
const statePath = join(ROOT, 'logs', `${NAME}-state.json`)

function log(message: string): void {
  const line = `${new Date().toISOString()} [${NAME}] ${message}`
  console.error(line)
  if (values['dry-run']) return // dry-run は画面に出すだけで、何も書かない
  try { appendFileSync(logFile, line + '\n', 'utf8') } catch { /* ログの失敗で処理を止めない */ }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function collectCandidates(): RecordingCandidate[] {
  if (!existsSync(dir)) return []
  const candidates: RecordingCandidate[] = []
  for (const name of readdirSync(dir)) {
    if (!isRecordingFile(name)) continue
    const path = join(dir, name)
    const stat = statSync(path)
    if (!stat.isFile()) continue
    const candidate: RecordingCandidate = { name, path, size: stat.size, mtimeMs: Math.trunc(stat.mtimeMs), stopMarker: existsSync(`${path}.stop`) || existsSync(join(dir, `${recordingStem(name)}.stop`)) }
    const sidecarPath = join(dir, `${recordingStem(name)}.recording.json`)
    if (existsSync(sidecarPath)) {
      try {
        candidate.sidecar = parseRecordingSidecar(readFileSync(sidecarPath, 'utf8'))
        if (candidate.sidecar.pid) candidate.pidAlive = pidAlive(candidate.sidecar.pid)
      } catch (error) {
        log(`録音の記録が読めないため目印なしとして扱う: ${sidecarPath}: ${(error as Error).message}`)
      }
    }
    candidates.push(candidate)
  }
  return candidates.sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name))
}

/** 同じリポジトリの tsx でスクリプトを動かす(npm を挟まない。Windows の npm.cmd の引数崩れを避ける)。 */
function runScript(script: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const tsx = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  const result = spawnSync(process.execPath, [tsx, join(ROOT, 'scripts', script), ...args], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true,
  })
  return { status: result.status ?? 1, stdout: result.stdout || '', stderr: (result.stderr || '') + (result.error ? result.error.message : '') }
}

function lastJson(stdout: string): Record<string, unknown> | undefined {
  const start = stdout.lastIndexOf('\n{')
  const text = (start >= 0 ? stdout.slice(start + 1) : stdout).trim()
  try { return JSON.parse(text) as Record<string, unknown> } catch { return undefined }
}

function tail(text: string): string {
  return text.trim().split(/\r?\n/).slice(-3).join(' / ').slice(0, 500)
}

function makeBundle(candidate: RecordingCandidate, dbJsonPath: string, transcriptPath: string): string {
  const stem = recordingStem(candidate.name)
  const output = join(logsDir(ROOT), 'interview-bundles', `${stem}-bundle.zip`)
  mkdirSync(join(logsDir(ROOT), 'interview-bundles'), { recursive: true })
  const shots = join(dir, `${stem}-shots`)
  const shell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh'
  const result = spawnSync(shell, [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(ROOT, 'scripts', 'new-interview-bundle.ps1'),
    '-DbJsonPath', dbJsonPath, '-TranscriptPath', transcriptPath,
    ...(existsSync(shots) ? ['-ShotsDirectory', shots] : []),
    '-AudioPath', candidate.path, '-OutputZipPath', output,
  ], { cwd: ROOT, encoding: 'utf8', windowsHide: true })
  if (result.error || result.status !== 0) throw new Error(`面談バンドルを作れません(${shell}): ${result.error?.message || tail(result.stderr || result.stdout)}`)
  return output
}

const release = values['dry-run'] ? () => {} : acquireLock(NAME, 6 * 60 * 60_000, ROOT)
if (!release) {
  log('前回の実行が続いているため何もしない(二重起動の防止)')
  process.exit(0)
}

let failures = 0
try {
  const state = parseAutopilotState(existsSync(statePath) ? readFileSync(statePath, 'utf8') : undefined)
  const saveState = () => { if (!values['dry-run']) writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8') }
  const now = Date.now()
  let processed = 0
  for (const candidate of collectCandidates()) {
    const decision = decideRecording(candidate, state.recordings[candidate.name], now)
    if (decision.action === 'skip') continue
    if (decision.action === 'wait') {
      if (values['dry-run']) log(`待つ: ${candidate.name}(${decision.reason})`)
      continue
    }
    if (decision.action === 'too-small') {
      log(`議事録化しない: ${candidate.name}(${decision.reason})`)
      if (!values['dry-run']) { recordOutcome(state, candidate, 'skipped', new Date(), { reason: decision.reason }); saveState() }
      continue
    }
    if (processed >= max) {
      log(`次回に回す: ${candidate.name}(1回あたり最大${max}件)`)
      continue
    }
    processed += 1
    const args = digestArguments(candidate, mode, { agent: values.agent, backend: values.backend, speakers: values.speakers, db: values.db })
    if (values['dry-run']) {
      log(`[dry-run] 処理する: ${candidate.name}(${decision.reason}) -> interview:digest ${args.slice(1).join(' ')}${mode === 'bundle' ? ' -> 面談バンドル' : ''}`)
      continue
    }

    log(`議事録化を始める: ${candidate.name}(${decision.reason}・${mode})`)
    const digest = runScript('interview-digest.ts', args)
    const result = lastJson(digest.stdout)
    const dbJsonPath = typeof result?.dbJsonPath === 'string' ? result.dbJsonPath : ''
    if (digest.status !== 0 || !dbJsonPath) {
      failures += 1
      const reason = `議事録化に失敗: ${tail(digest.stderr) || `終了コード ${digest.status}`}`
      const entry = recordOutcome(state, candidate, 'failed', new Date(), { reason })
      saveState()
      log(`!! ${candidate.name}: ${reason}(${entry.attempts}回目)`)
      recordAlert(NAME, `${candidate.name}: ${reason}`, logFile, ROOT)
      continue
    }

    const notes: string[] = []
    const shots = join(dir, `${recordingStem(candidate.name)}-shots`)
    if (!values['no-faces'] && existsSync(shots)) {
      const faces = runScript('interview-faces.ts', ['detect', candidate.path])
      if (faces.status === 0) {
        const facesResult = lastJson(faces.stdout)
        const count = Array.isArray(facesResult?.faces) ? facesResult.faces.length : 0
        notes.push(count ? `顔写真の候補${count}枚(誰の顔かは要確認: ${join(shots, 'faces.json')})` : '顔写真の候補なし')
      } else if (faces.status === 2) {
        notes.push('顔検出器が使えないため顔写真は保留(pip install opencv-python か --box で手動)')
      } else {
        notes.push(`顔写真の切り出しに失敗(議事録は成功): ${tail(faces.stderr)}`)
      }
    }

    let bundle = ''
    if (mode === 'bundle') {
      try {
        bundle = makeBundle(candidate, dbJsonPath, typeof result?.transcriptPath === 'string' ? result.transcriptPath : '')
        notes.push(`面談バンドル: ${bundle}`)
      } catch (error) {
        failures += 1
        const reason = (error as Error).message
        recordOutcome(state, candidate, 'failed', new Date(), { reason, dbJsonPath })
        saveState()
        log(`!! ${candidate.name}: ${reason}`)
        recordAlert(NAME, `${candidate.name}: ${reason}`, logFile, ROOT)
        continue
      }
    }

    recordOutcome(state, candidate, 'done', new Date(), { dbJsonPath })
    saveState()
    for (const note of notes) log(`${candidate.name}: ${note}`)
    log(`完了: ${candidate.name} -> ${dbJsonPath}${mode === 'apply' ? '(正本DBへ反映済み)' : ''}`)
    appendActivity({
      by: NAME,
      action: '録音の終わった面談を議事録にした',
      why: '録音のたびに手で議事録化を起動しなくても、面談の記録を漏らさないため',
      how: `録り終わりを検知→interview:digest${mode === 'apply' ? '(--apply)' : ''}${mode === 'bundle' ? '→面談バンドル' : ''}`,
      link: `logs/${NAME}.log`,
      result: notes.some((note) => note.includes('要確認')) ? '成功(顔写真は要確認)' : '成功',
    }, ROOT)
  }
  if (!values['dry-run'] && processed > 0 && failures === 0) clearAlert(NAME, ROOT)
  if (values['dry-run'] && processed === 0) log('[dry-run] 処理する録音は無い')
} catch (error) {
  failures += 1
  log(`!! ${(error as Error).message}`)
  recordAlert(NAME, (error as Error).message, logFile, ROOT)
} finally {
  release()
}
process.exit(failures ? 1 : 0)
