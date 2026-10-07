/**
 * 文字起こしから議事録(人が読むMarkdown + DB反映用の InterviewInput)を作るための規則。
 *
 * モデルの役割は「文字起こしを読んで厳格JSONを1つ返す」ことだけにする(ツールなし・読み取り専用)。
 * runId・予定ID・支援面談ID・文字起こしのパスは実行側が決め、モデルの出力では上書きさせない。
 * 取り違えた予定へ議事録を結び付けたり、存在しないファイルを根拠として記録したりしないため。
 * DBへの反映は src/db-apply-interview.ts(同じ機械)か面談バンドル(別の機械)が行う。
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateJsonSchema } from './agent-runtime.js'
import { validateInterviewInput, type InterviewInput } from './db-apply-interview.js'
import { renderTemplate } from './katazuku-config.js'

const here = dirname(fileURLToPath(import.meta.url))
export const INTERVIEW_MINUTES_SCHEMA_PATH = join(here, '..', 'schemas', 'interview-minutes.schema.json')

export interface MinutesContext {
  /** 応募企業の選考予定(appointment.id)。1以上のときだけ */
  appointmentId?: number
  /** 就活エージェント等との支援面談(career_meeting.id)。1以上のときだけ */
  careerMeetingId?: number
  company?: string
  organization?: string
  position?: string
  /** 面談の開始時刻(ISO 8601)。分かっていればモデルの推定より優先する */
  occurredAt?: string
  /** 元の録音(または文字起こし)のファイル名。日付の手がかりと runId に使う */
  sourceName: string
  /** 元ファイルの更新時刻(ISO 8601)。録音終了の目安 */
  sourceModifiedAt?: string
  /** DBに記録する文字起こしのパス */
  transcriptPath: string
}

export interface MinutesInterview {
  kind: 'selection' | 'career_support'
  company?: string
  organization?: string
  position?: string
  occurredAt: string
  title: string
  summary: string
  questions: { question: string; answer?: string; feedback?: string }[]
  people: { name: string; company?: string; role?: string; category?: string; notes: string[]; confidence: number }[]
  profileSuggestions: { field: string; value: string; confidence: number }[]
  followUps: string[]
}

export interface MinutesOutput {
  schemaVersion: 1
  minutesMarkdown: string
  interview: MinutesInterview
}

function positive(value: number | undefined): number | undefined {
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : undefined
}

/** 実行側の値の矛盾を、モデルを呼ぶ前に止める。 */
export function assertMinutesContext(context: MinutesContext): void {
  if (context.appointmentId !== undefined && !positive(context.appointmentId)) throw new Error('予定IDは1以上の整数です')
  if (context.careerMeetingId !== undefined && !positive(context.careerMeetingId)) throw new Error('支援面談IDは1以上の整数です')
  if (positive(context.appointmentId) && positive(context.careerMeetingId)) {
    throw new Error('予定IDと支援面談IDは同時に指定できません(応募選考か支援面談のどちらか)')
  }
  if (context.occurredAt && Number.isNaN(Date.parse(context.occurredAt))) throw new Error(`面談の日時が読めません: ${context.occurredAt}`)
  if (!context.sourceName.trim()) throw new Error('元ファイル名が空です')
}

/**
 * 議事録の runId(DBの source_ref)。予定に結び付くなら予定ID由来にして、
 * 録音機と正本DBの機械のどちらで作っても、何度作り直しても同じ値になるようにする。
 */
export function minutesRunId(context: Pick<MinutesContext, 'appointmentId' | 'careerMeetingId' | 'sourceName'>): string {
  const appointment = positive(context.appointmentId)
  if (appointment) return `meeting-${appointment}`
  const career = positive(context.careerMeetingId)
  if (career) return `career-meeting-${career}`
  const stem = context.sourceName.replace(/\.[^.]+$/, '').replace(/-transcript$/, '')
  const safe = stem.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  if (!safe) throw new Error('予定IDが無く、元ファイル名からも runId を作れません(英数字を含む名前にしてください)')
  return `recording-${safe}`
}

/** プロンプトへ渡す「実行側が分かっていること」。 */
export function describeMinutesContext(context: MinutesContext): string {
  const lines = [`- 元ファイル名: ${context.sourceName}`]
  if (context.sourceModifiedAt) lines.push(`- 元ファイルの更新時刻(録音終了の目安): ${context.sourceModifiedAt}`)
  if (positive(context.appointmentId)) lines.push('- 種別: 応募企業の選考(kind は selection)')
  else if (positive(context.careerMeetingId)) lines.push('- 種別: 就活エージェント・イベント運営者などとの支援面談(kind は career_support)')
  else lines.push('- 種別: 未指定(文字起こしから selection / career_support を判断する)')
  if (context.company) lines.push(`- 企業名(確定): ${context.company}`)
  if (context.organization) lines.push(`- 運営組織(確定): ${context.organization}`)
  if (context.position) lines.push(`- 職種・コース(確定): ${context.position}`)
  if (context.occurredAt) lines.push(`- 面談の開始時刻(確定): ${context.occurredAt}`)
  return lines.join('\n')
}

/** 議事録化のプロンプトを組み立てる。文字起こしは指示ではなくデータとして区切って渡す。 */
export function buildMinutesPrompt(template: string, transcript: string, context: MinutesContext, vars: { USER_NAME?: string; TIMEZONE?: string } = {}): string {
  // Windows の checkout では改行が CRLF になる。文字起こしと揃えて LF にする
  return renderTemplate(template.replace(/\r\n/g, '\n'), {
    USER_NAME: vars.USER_NAME || '本人',
    TIMEZONE: vars.TIMEZONE || 'Asia/Tokyo',
    CONTEXT: describeMinutesContext(context),
    TRANSCRIPT: transcript.replace(/\r\n/g, '\n').trim(),
  })
}

/**
 * 意味を変えずに直せる形の揺れだけを直す。文字列の配列に1つの文字列を入れてくる揺れは
 * モデルを問わず起きやすい(「メモを1行残す」と指示すると notes を文字列で返す、など)。
 * 値の中身は変えない。それ以外の食い違いは Schema の検査でそのまま拒否する。
 */
export function normalizeMinutesOutput(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  const interview = (value as { interview?: Record<string, unknown> }).interview
  if (!interview || typeof interview !== 'object') return value
  const asList = (item: unknown) => (typeof item === 'string' ? (item.trim() ? [item] : []) : item)
  interview.followUps = asList(interview.followUps)
  if (Array.isArray(interview.people)) {
    for (const person of interview.people as Record<string, unknown>[]) {
      if (person && typeof person === 'object') person.notes = asList(person.notes ?? [])
    }
  }
  return value
}

/** モデルの出力を取り出して Schema で検査する。前後のコードフェンスだけは許す。 */
export function parseMinutesOutput(output: string, schema: unknown): MinutesOutput {
  const trimmed = output.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  let value: unknown
  try {
    value = normalizeMinutesOutput(JSON.parse(fenced ? fenced[1] : trimmed))
  } catch (error) {
    throw new Error(`議事録の出力がJSONではありません: ${(error as Error).message}`)
  }
  const errors = validateJsonSchema(value, schema)
  if (errors.length) throw new Error(`議事録の出力が Schema に合いません: ${errors.slice(0, 5).join(' / ')}`)
  return value as MinutesOutput
}

/**
 * モデルの出力と実行側の値を合わせて、DB反映用の InterviewInput にする。
 * 実行側の値(予定ID・企業名・日時など)が渡されていれば、そちらを優先する。
 */
export function toInterviewInput(output: MinutesOutput, context: MinutesContext): InterviewInput {
  assertMinutesContext(context)
  const model = output.interview
  const appointmentId = positive(context.appointmentId)
  const careerMeetingId = positive(context.careerMeetingId)
  const support = careerMeetingId ? true : appointmentId ? false : model.kind === 'career_support'
  const input: InterviewInput = {
    runId: minutesRunId(context),
    occurredAt: context.occurredAt || model.occurredAt,
    title: model.title.trim(),
    summary: model.summary.trim(),
    transcriptPath: context.transcriptPath,
    questions: model.questions,
    people: model.people,
    profileSuggestions: model.profileSuggestions,
    followUps: model.followUps,
  }
  if (support) {
    input.contextKind = 'career_support'
    if (careerMeetingId) input.careerMeetingId = careerMeetingId
    const organization = (context.organization || model.organization || '').trim()
    if (organization) input.organization = organization
  } else {
    input.contextKind = 'selection'
    if (appointmentId) input.appointmentId = appointmentId
    const company = (context.company || model.company || '').trim()
    if (company) input.company = company
    const position = (context.position || model.position || '').trim()
    if (position) input.position = position
  }
  validateInterviewInput(input)
  return input
}
