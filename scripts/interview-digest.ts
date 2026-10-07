/**
 * 面談の録音(または文字起こし)から議事録を作る。
 *
 *   npm run interview:digest -- <録音 | 文字起こし.txt> [--appointment <予定ID> | --career-meeting <支援面談ID>]
 *       [--company <企業名>] [--organization <運営組織>] [--position <職種>] [--occurred-at <ISO>]
 *       [--backend auto|voicebox|faster-whisper] [--speakers] [--out-dir <dir>]
 *       [--agent auto|claude|codex|...] [--apply [--db <path>]] [--dry-run]
 *
 * 1. 録音なら決定的に文字起こしする(src/transcribe-audio.ts。.txt / .md を渡したら省略)
 * 2. 読み取り専用のエージェントが、文字起こしから議事録の厳格JSONを1つ返す(ツールなし)
 * 3. Schema と必須項目を検査し、<名前>-db.json(DB反映用)と <名前>-minutes.md(人が読む議事録)を書く
 * 4. --apply なら、この機械の正本DBへ1トランザクションで反映する(runIdで冪等)。
 *    正本DBが別の機械なら scripts/new-interview-bundle.ps1 で面談バンドルにして運ぶ
 *
 * 流れと前提は docs/TRANSCRIPTION.md。
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { applyInterview } from '../src/db-apply-interview.js'
import { openDb } from '../src/db.js'
import { repositoryRoot, resolveDatabasePath } from '../src/database-path.js'
import {
  assertMinutesContext,
  buildMinutesPrompt,
  INTERVIEW_MINUTES_SCHEMA_PATH,
  minutesRunId,
  parseMinutesOutput,
  toInterviewInput,
  type MinutesContext,
} from '../src/interview-minutes.js'
import { loadConfig, providerOrderFor, templateVars } from '../src/katazuku-config.js'
import { transcribeAudio, defaultTranscriptPath } from '../src/transcribe-audio.js'
import type { TranscriptionBackendRequest } from '../src/transcription.js'
import { appendActivity, describeFailure, runAgentStep } from '../src/workflow-support.js'

const ROOT = repositoryRoot()
if (existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'))
const TEXT_EXTENSIONS = new Set(['.txt', '.md'])
const USAGE = [
  '使い方: npm run interview:digest -- <録音 | 文字起こし.txt> [--appointment <ID> | --career-meeting <ID>]',
  '        [--company <企業名>] [--organization <運営組織>] [--position <職種>] [--occurred-at <ISO>]',
  '        [--backend auto|voicebox|faster-whisper] [--speakers] [--out-dir <dir>] [--agent <provider>] [--apply [--db <path>]] [--dry-run]',
].join('\n')

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

function optionalId(value: string | undefined, label: string): number | undefined {
  if (value === undefined) return undefined
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) fail(`${label}は1以上の整数です: ${value}`)
  return id
}

let parsed
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      appointment: { type: 'string' },
      'career-meeting': { type: 'string' },
      company: { type: 'string' },
      organization: { type: 'string' },
      position: { type: 'string' },
      'occurred-at': { type: 'string' },
      backend: { type: 'string', default: 'auto' },
      speakers: { type: 'boolean', default: false },
      'out-dir': { type: 'string' },
      agent: { type: 'string', default: 'auto' },
      apply: { type: 'boolean', default: false },
      db: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
    },
  })
} catch (error) {
  fail(`${(error as Error).message}\n${USAGE}`)
}
const values = parsed.values
const inputArg = parsed.positionals[0]
if (!inputArg) fail(USAGE)
const input = resolve(inputArg)
if (!existsSync(input)) fail(`ファイルがありません: ${input}`)
const backend = values.backend as TranscriptionBackendRequest
if (!['auto', 'voicebox', 'faster-whisper'].includes(backend)) fail(USAGE)
if (values.db && !values.apply) fail('--db は --apply と一緒に指定します')

const isTranscript = TEXT_EXTENSIONS.has(extname(input).toLowerCase())
const plannedTranscript = isTranscript
  ? input
  : values['out-dir']
    ? join(resolve(values['out-dir']), basename(defaultTranscriptPath(input, ROOT)))
    : defaultTranscriptPath(input, ROOT)
const context: MinutesContext = {
  appointmentId: optionalId(values.appointment, '予定ID'),
  careerMeetingId: optionalId(values['career-meeting'], '支援面談ID'),
  company: values.company?.trim() || undefined,
  organization: values.organization?.trim() || undefined,
  position: values.position?.trim() || undefined,
  occurredAt: values['occurred-at']?.trim() || undefined,
  sourceName: basename(input),
  sourceModifiedAt: statSync(input).mtime.toISOString(),
  transcriptPath: plannedTranscript,
}
try {
  assertMinutesContext(context)
} catch (error) {
  fail((error as Error).message)
}

const config = loadConfig(ROOT)
const runId = minutesRunId(context)
const outDir = values['out-dir'] ? resolve(values['out-dir']) : dirname(plannedTranscript)
const stem = basename(plannedTranscript, extname(plannedTranscript)).replace(/-transcript$/, '')
const dbJsonPath = join(outDir, `${stem}-db.json`)
const minutesPath = join(outDir, `${stem}-minutes.md`)
const template = readFileSync(join(ROOT, 'scripts', 'interview-digest-prompt.md'), 'utf8')
const vars = templateVars(config)

if (values['dry-run']) {
  console.log('[dry-run] workflow=interview-digest')
  console.log(`[dry-run] runId: ${runId}`)
  console.log(`[dry-run] 文字起こし: ${isTranscript ? `既存を使う ${input}` : `${backend} で作る -> ${plannedTranscript}${values.speakers ? '(左右別・話者ラベル付き)' : ''}`}`)
  console.log(`[dry-run] provider順: ${providerOrderFor(config, 'interview-digest').join(' -> ')}`)
  console.log('[dry-run] capabilities: (なし。読み取り専用・ツールなし)')
  console.log(`[dry-run] 出力: ${dbJsonPath} / ${minutesPath}${values.apply ? ` / 正本DBへ反映(${resolveDatabasePath(values.db)})` : ''}`)
  const sample = isTranscript ? readFileSync(input, 'utf8') : '(録音の文字起こしがここに入る)'
  console.log('[dry-run] ---- プロンプト(先頭2000字) ----')
  console.log(buildMinutesPrompt(template, sample, context, vars).slice(0, 2000))
  process.exit(0)
}

try {
  let transcriptPath = input
  if (!isTranscript) {
    const transcribed = await transcribeAudio({ input, output: plannedTranscript, backend, speakers: values.speakers, force: values.force })
    transcriptPath = transcribed.output
    console.error(`文字起こし: ${transcriptPath}${transcribed.reused ? '(再利用)' : ''}`)
  }
  const transcript = readFileSync(transcriptPath, 'utf8')
  if (!transcript.trim()) throw new Error(`文字起こしが空です: ${transcriptPath}`)

  const prompt = buildMinutesPrompt(template, transcript, context, vars)
  const result = await runAgentStep({
    config, workflow: 'interview-digest',
    // 実行基盤は同じ実行IDの結果を再生する。作り直しのたびに新しい実行として扱うため時刻を含める
    runId: `interview-digest:${new Date().toISOString().replace(/[-:.]/g, '')}:${runId}`, prompt,
    // 文字起こしはプロンプトに埋め込むので、ツールは何も渡さない(読み取り専用・副作用なし)
    // Schema の検査は実行基盤ではなく下の parseMinutesOutput で行う(意味を変えない形の揺れを直してから検査するため)
    capabilities: [], risk: 'read-only', sideEffectMode: 'none', timeoutMs: 30 * 60_000, agent: values.agent,
  })
  if (result.status !== 'succeeded' || !result.output) throw new Error('議事録化に失敗しました: ' + describeFailure(result))
  const output = parseMinutesOutput(result.output, JSON.parse(readFileSync(INTERVIEW_MINUTES_SCHEMA_PATH, 'utf8')))
  const interview = toInterviewInput(output, context)

  mkdirSync(outDir, { recursive: true })
  writeFileSync(dbJsonPath, JSON.stringify(interview, null, 2) + '\n', 'utf8')
  writeFileSync(minutesPath, output.minutesMarkdown.trim() + '\n', 'utf8')
  console.error(`議事録: ${minutesPath}`)
  console.error(`DB反映用JSON: ${dbJsonPath}`)

  let applied: ReturnType<typeof applyInterview> | undefined
  if (values.apply) {
    const db = openDb(resolveDatabasePath(values.db))
    try {
      applied = applyInterview(interview, db)
    } finally {
      db.close()
    }
  } else {
    console.error('正本DBへ反映するには --apply を付けて再実行するか、別の機械なら面談バンドルで運んでください(docs/INTERVIEW-BUNDLE.md)')
  }
  appendActivity({
    by: 'interview-digest', action: '面談の議事録を作成',
    why: '面談を後から振り返り、次の選考対策と志望動機に反映するため',
    how: `文字起こし→読み取り専用の議事録化→検査${applied ? '→正本DBへ反映' : ''}`,
    link: minutesPath.startsWith(ROOT) ? minutesPath.slice(ROOT.length + 1) : undefined,
    result: '成功',
  }, ROOT)
  console.log(JSON.stringify({ runId, transcriptPath, dbJsonPath, minutesPath, applied: applied ?? null }, null, 2))
} catch (error) {
  fail((error as Error).message)
}
