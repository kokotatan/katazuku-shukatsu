import { existsSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import { getDatabaseContext, resolveCompany } from './db'
import { getScheduleAvailability, type ScheduleAvailability } from './schedule'
import { workflowHash } from './workflow-control'

export interface ThirdPartyEmailAction {
  actionType: 'gmail.send'
  target: {
    userGoogleEmail: string
    to: string[]
    cc?: string[]
    bcc?: string[]
    companyName: string
    selectionId?: number
  }
  content: {
    subject: string
    body: string
    threadId: string
    sourceMessageId: string
    inReplyTo?: string
    references?: string
    attachments?: { path: string; filename: string; mimeType: string }[]
    scheduleCommitments: { startAt: string; endAt: string }[]
  }
  effectiveAt: 'immediate'
  notification: string
}

export interface EmailPreflightResult {
  ok: boolean
  actionHash: string
  database: ReturnType<typeof getDatabaseContext>
  companyId?: number
  mailItemId?: string
  issues: string[]
  schedule: ScheduleAvailability[]
}

const DISCLOSURE_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /他社(?:の)?(?:選考|面接|インターン|予定)/, label: '他社の選考情報' },
  { pattern: /(?:他|別)のインターン/, label: '別のインターン情報' },
  { pattern: /面接が(?:ある|入って|あり)/, label: '面接を理由にした説明' },
  { pattern: /訪中団|訪中歴/, label: '就活先に不要な訪中情報' },
  { pattern: /インターンの帰り|選考の帰り/, label: '別案件からの帰路情報' },
]

export function professionalEmailIssues(body: string): string[] {
  const issues: string[] = []
  for (const item of DISCLOSURE_PATTERNS) if (item.pattern.test(body)) issues.push(`${item.label}を本文へ書かないでください`)
  if (/御社/.test(body)) issues.push('書き言葉では「御社」でなく「貴社」を使ってください')
  if (/了解しました/.test(body)) issues.push('「了解しました」でなく「承知いたしました」を使ってください')
  if (/\*\*|__/.test(body)) issues.push('メール本文へMarkdown装飾を入れないでください')
  return issues
}

export function hasScheduleCommitmentLanguage(action: ThirdPartyEmailAction): boolean {
  const text = `${action.content.subject}\n${action.content.body}`
  const hasDateOrTime = /(?:20\d{2}[年/-])?\d{1,2}[月/-]\d{1,2}日?|\d{1,2}時(?:\d{1,2}分)?/.test(text)
  const hasCommitment = /希望|参加|伺|開始|日程|日時|お時間|到着|予約|調整/.test(text)
  return hasDateOrTime && hasCommitment
}

export function buildWorkspaceSendCall(action: ThirdPartyEmailAction): { name: string; arguments: Record<string, unknown> } {
  const args: Record<string, unknown> = {
    user_google_email: action.target.userGoogleEmail,
    to: action.target.to.join(', '),
    subject: action.content.subject,
    body: action.content.body,
    body_format: 'plain',
    thread_id: action.content.threadId,
    include_signature: false,
    quote_original: false,
  }
  if (action.target.cc?.length) args.cc = action.target.cc.join(', ')
  if (action.target.bcc?.length) args.bcc = action.target.bcc.join(', ')
  if (action.content.inReplyTo) args.in_reply_to = action.content.inReplyTo
  if (action.content.references) args.references = action.content.references
  if (action.content.attachments?.length) {
    args.attachments = action.content.attachments.map((item) => ({
      path: item.path, filename: item.filename, mime_type: item.mimeType,
    }))
  }
  return { name: 'send_gmail_message', arguments: args }
}

export function preflightThirdPartyEmail(
  db: DatabaseSync,
  action: ThirdPartyEmailAction,
  options: { now?: Date } = {},
): EmailPreflightResult {
  const database = getDatabaseContext(db)
  const issues = professionalEmailIssues(action.content.body)
  const schedule: ScheduleAvailability[] = []
  if (database.role !== 'canonical') issues.push(`正本DBではありません(role=${database.role})`)

  const resolution = resolveCompany(db, action.target.companyName)
  const companyId = resolution.kind === 'hit' ? resolution.companyId : undefined
  if (!companyId) issues.push(`企業を正本DBで一意に確認できません: ${action.target.companyName}`)

  const mail = db.prepare(`
    SELECT id, company_id AS companyId, selection_id AS selectionId, source_ref AS sourceRef
    FROM mail_item WHERE id = ? OR source_ref = ? OR source_ref LIKE ? ORDER BY received_at DESC LIMIT 1
  `).get(action.content.sourceMessageId, action.content.sourceMessageId, `%${action.content.sourceMessageId}%`) as
    { id: string; companyId: number | null; selectionId: number | null; sourceRef: string } | undefined
  if (!mail) issues.push(`元メールを正本DBで確認できません: ${action.content.sourceMessageId}`)
  if (mail && companyId && mail.companyId && mail.companyId !== companyId) {
    issues.push('元メールの企業と送信先企業が一致しません')
  }
  if (action.target.selectionId) {
    const selection = db.prepare('SELECT company_id AS companyId FROM selection WHERE id = ?')
      .get(action.target.selectionId) as { companyId: number } | undefined
    if (!selection) issues.push(`選考トラックが正本DBにありません: ${action.target.selectionId}`)
    else if (companyId && selection.companyId !== companyId) issues.push('選考トラックと送信先企業が一致しません')
    if (mail?.selectionId && mail.selectionId !== action.target.selectionId) issues.push('元メールと指定した選考トラックが一致しません')
  }

  const scheduleLanguage = hasScheduleCommitmentLanguage(action)
  if (scheduleLanguage && action.content.scheduleCommitments.length === 0) {
    issues.push('日時を約束する文面なのにscheduleCommitmentsがありません')
  }
  for (const commitment of action.content.scheduleCommitments) {
    const availability = getScheduleAvailability(db, commitment.startAt, commitment.endAt, {
      now: options.now,
      requireCanonical: true,
      requireCalendarFreshness: true,
    })
    schedule.push(availability)
    if (availability.state !== 'available' || !availability.available || availability.database.role !== 'canonical') {
      issues.push(`日時を確定できません: ${commitment.startAt}〜${commitment.endAt} (${availability.state})`)
    }
  }
  for (const attachment of action.content.attachments ?? []) {
    if (!existsSync(attachment.path)) issues.push(`添付ファイルが見つかりません: ${attachment.path}`)
  }

  return {
    ok: issues.length === 0,
    actionHash: workflowHash(action),
    database,
    companyId,
    mailItemId: mail?.id,
    issues,
    schedule,
  }
}
