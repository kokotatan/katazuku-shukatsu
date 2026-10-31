import { existsSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { resolveCompany } from './db.js'
import { getBasicProfile } from './platform.js'
import { getDatabaseContext, getScheduleAvailability, type ScheduleAvailability } from './schedule.js'
import {
  beginWorkflowStep,
  completeWorkflowStep,
  failWorkflowStep,
  workflowHash,
  type WorkflowContract,
} from './workflow-control.js'

export interface ThirdPartyEmailAction {
  /** gmail.sendはv1互換。新規actionはproviderを固定したemail.sendを使う。 */
  actionType: 'email.send' | 'gmail.send'
  target: {
    provider?: 'google-workspace' | 'icloud-mail'
    senderEmail?: string
    userGoogleEmail?: string
    context?: 'recruiting' | 'business' | 'education' | 'personal'
    to: string[]
    cc?: string[]
    bcc?: string[]
    companyName?: string
    counterpartyName?: string
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
    scheduleCommitments: { startAt: string; endAt: string; appointmentId?: number }[]
  }
  effectiveAt: 'immediate'
  notification: string
}

export interface EmailIdentity {
  name: string
  affiliation: string
  email?: string
  phone?: string
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

export interface EmailDeliveryState {
  /** unknownは「送られていない」ではない。Executorは再送せず停止する。 */
  state: 'sent' | 'not_sent' | 'unknown'
  /** 外部message ID等。本文やtokenを入れない。 */
  receiptRef?: string
}

export interface EmailDeliveryAdapter {
  /** 同一thread・宛先・本文のSENT記録を外部サービスで照合する。 */
  reconcile(action: ThirdPartyEmailAction): Promise<EmailDeliveryState>
  /** 承認済みactionを一度だけ送る。呼出し後の成否不明は例外でよいが、再送してはならない。 */
  send(action: ThirdPartyEmailAction): Promise<void>
}

export interface EmailTransportIdentity {
  provider: 'google-workspace' | 'icloud-mail'
  senderEmail: string
}

export interface ExecuteApprovedEmailOptions {
  canonicalDb: DatabaseSync
  workflowStore: DatabaseSync
  contract: WorkflowContract
  runId: string
  action: ThirdPartyEmailAction
  adapter: EmailDeliveryAdapter
  now?: Date
  identity?: EmailIdentity
}

const DISCLOSURE_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /他社(?:の)?(?:選考|面接|インターン|予定)/, label: '他社の選考情報' },
  { pattern: /(?:他|別)のインターン/, label: '別のインターン情報' },
  { pattern: /面接が(?:ある|入って|あり)/, label: '面接を理由にした説明' },
  { pattern: /インターンの帰り|選考の帰り/, label: '別案件からの帰路情報' },
]

function stringField(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) if (typeof record[key] === 'string' && String(record[key]).trim()) return String(record[key]).trim()
  return ''
}

export function emailIdentityFromProfile(profile: unknown): EmailIdentity {
  const record = profile && typeof profile === 'object' && !Array.isArray(profile)
    ? profile as Record<string, unknown>
    : {}
  return {
    name: stringField(record, ['name', 'fullName', 'displayName']),
    affiliation: stringField(record, ['university', 'affiliation', 'organization', 'school']),
    email: stringField(record, ['email', 'mail']) || undefined,
    phone: stringField(record, ['phone', 'tel', 'telephone']) || undefined,
  }
}

function compactIdentity(value: string): string {
  return value.normalize('NFKC').replace(/[\s　]+/gu, '').toLowerCase()
}

/** 採用担当向け本文の基本形と、相手へ不要な第三者情報の混入を検査する。 */
export function professionalEmailIssues(body: string, identity: EmailIdentity): string[] {
  const issues: string[] = []
  const normalized = body.replace(/\r\n/g, '\n').trim()
  const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean)
  const greetingIndex = lines.findIndex((line) => /お世話になっております/.test(line))
  const closingIndex = lines.findIndex((line) => /よろしく(?:お願いいたします|お願い申し上げます)/.test(line))
  const nameKey = compactIdentity(identity.name)
  const affiliationKey = compactIdentity(identity.affiliation)

  if (!identity.name) issues.push('正本プロフィールに氏名がありません')
  if (!identity.affiliation) issues.push('正本プロフィールに所属がありません')
  if (!lines.slice(0, greetingIndex >= 0 ? greetingIndex : 3).some((line) => /(?:様|御中)$/.test(line))) {
    issues.push('採用担当宛メールには冒頭の宛名（様または御中）が必要です')
  }
  if (greetingIndex < 0) issues.push('採用担当宛メールには「お世話になっております」の挨拶が必要です')
  if (nameKey && !compactIdentity(normalized).includes(nameKey)) issues.push('採用担当宛メールには本人の氏名が必要です')
  if (affiliationKey && !compactIdentity(normalized).includes(affiliationKey)) issues.push('採用担当宛メールには本人の所属が必要です')
  if (closingIndex < 0) issues.push('採用担当宛メールには結びの挨拶が必要です')
  if (closingIndex >= 0 && nameKey && !lines.slice(closingIndex + 1).some((line) => compactIdentity(line).includes(nameKey))) {
    issues.push('結びの後に氏名を記載した署名が必要です')
  }
  if (identity.phone && !/^TEL\s*[:：]/mi.test(normalized)) issues.push('署名にはTELが必要です')
  if (identity.email && !/^Mail\s*[:：]/mi.test(normalized)) issues.push('署名にはMailが必要です')
  for (const item of DISCLOSURE_PATTERNS) if (item.pattern.test(body)) issues.push(`${item.label}を本文へ書かないでください`)
  if (/御社/.test(body)) issues.push('書き言葉では「御社」でなく「貴社」を使ってください')
  if (/了解しました/.test(body)) issues.push('「了解しました」でなく「承知いたしました」を使ってください')
  if (/\*\*|__/.test(body)) issues.push('メール本文へMarkdown装飾を入れないでください')
  return issues
}

export function emailStyleIssues(
  body: string,
  identity: EmailIdentity,
  context: NonNullable<ThirdPartyEmailAction['target']['context']> = 'recruiting',
): string[] {
  if (context === 'recruiting') return professionalEmailIssues(body, identity)
  const issues: string[] = []
  const normalized = body.replace(/\r\n/g, '\n').trim()
  if (!normalized) issues.push('メール本文がありません')
  if (/\*\*|__/.test(body)) issues.push('メール本文へMarkdown装飾を入れないでください')
  for (const item of DISCLOSURE_PATTERNS) if (item.pattern.test(body)) issues.push(`${item.label}を本文へ書かないでください`)
  if (identity.name && !compactIdentity(normalized).includes(compactIdentity(identity.name))) {
    issues.push('本文または署名に本人の氏名が必要です')
  }
  return issues
}

export function hasScheduleCommitmentLanguage(action: ThirdPartyEmailAction): boolean {
  const text = `${action.content.subject}\n${action.content.body}`
  const hasDateOrTime = /(?:20\d{2}[年/-])?\d{1,2}[月/-]\d{1,2}日?|\d{1,2}時(?:\d{1,2}分)?/.test(text)
  if (!hasDateOrTime) return false
  if (/(?:参加|出席|伺|予約|希望|調整)(?:いたします|します|させていただきます|を希望|いただけますと)/.test(action.content.body)) return true
  if (/(?:見送|辞退|不参加|欠席|キャンセル|取り消)/.test(action.content.body)) return false
  return /希望|参加|伺|開始|日程|日時|お時間|到着|予約|調整/.test(text)
}

/** Google Workspace bridgeへ渡す送信call。承認済みaction以外から組み立ててはならない。 */
export function buildWorkspaceSendCall(action: ThirdPartyEmailAction): { name: string; arguments: Record<string, unknown> } {
  const transport = emailTransportIdentity(action)
  if (transport.provider !== 'google-workspace') throw new Error('Google Workspace以外のactionをGmail transportへ渡せません')
  const args: Record<string, unknown> = {
    user_google_email: transport.senderEmail,
    to: action.target.to.join(', '),
    subject: action.content.subject,
    body: action.content.body,
    body_format: 'plain',
    thread_id: action.content.threadId,
    include_signature: false,
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

export function emailTransportIdentity(action: ThirdPartyEmailAction): EmailTransportIdentity {
  const provider = action.actionType === 'gmail.send'
    ? 'google-workspace'
    : action.target.provider
  const senderEmail = (action.target.senderEmail ?? action.target.userGoogleEmail ?? '').trim().toLowerCase()
  if (provider !== 'google-workspace' && provider !== 'icloud-mail') throw new Error('メールproviderが不正です')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail)) throw new Error('送信元メールアドレスが不正です')
  if (action.actionType === 'gmail.send' && action.target.provider && action.target.provider !== 'google-workspace') {
    throw new Error('gmail.sendのproviderはgoogle-workspaceだけです')
  }
  return { provider, senderEmail }
}

export function emailTransportCapabilities(action: ThirdPartyEmailAction): string[] {
  const { provider } = emailTransportIdentity(action)
  return provider === 'google-workspace'
    ? ['gmail.read', 'gmail.send.confirmed']
    : ['icloud-mail.read', 'icloud-mail.send.confirmed']
}

export function preflightThirdPartyEmail(
  db: DatabaseSync,
  action: ThirdPartyEmailAction,
  options: { now?: Date; identity?: EmailIdentity } = {},
): EmailPreflightResult {
  const database = getDatabaseContext(db)
  const identity = options.identity ?? emailIdentityFromProfile(getBasicProfile(db))
  const context = action.target.context ?? 'recruiting'
  const issues = emailStyleIssues(action.content.body, identity, context)
  const schedule: ScheduleAvailability[] = []
  if (database.role !== 'canonical') issues.push(`正本DBではありません(role=${database.role})`)
  try { emailTransportIdentity(action) } catch (error) { issues.push(error instanceof Error ? error.message : 'メール送信元が不正です') }
  if (!['email.send', 'gmail.send'].includes(action.actionType) || action.effectiveAt !== 'immediate') issues.push('対応していないメール操作です')
  if (!action.target.to.length) issues.push('送信先がありません')

  const resolution = action.target.companyName ? resolveCompany(db, action.target.companyName) : undefined
  const companyId = resolution?.kind === 'hit' ? resolution.companyId : undefined
  if (context === 'recruiting' && !companyId) issues.push(`企業を正本DBで一意に確認できません: ${action.target.companyName ?? '未指定'}`)
  if (context !== 'recruiting' && !action.target.counterpartyName?.trim() && !action.target.companyName?.trim()) {
    issues.push('連絡相手の名称がありません')
  }

  const mail = db.prepare(`
    SELECT id, company_id AS companyId, selection_id AS selectionId, source_ref AS sourceRef
    FROM mail_item WHERE id = ? OR source_ref = ? OR source_ref LIKE ? ORDER BY received_at DESC LIMIT 1
  `).get(action.content.sourceMessageId, action.content.sourceMessageId, `%${action.content.sourceMessageId}%`) as
    { id: string; companyId: number | null; selectionId: number | null; sourceRef: string } | undefined
  if (!mail) issues.push(`元メールを正本DBで確認できません: ${action.content.sourceMessageId}`)
  if (mail && companyId && mail.companyId && mail.companyId !== companyId) issues.push('元メールの企業と送信先企業が一致しません')

  if (action.target.selectionId) {
    if (context !== 'recruiting') issues.push('採用以外のメールへselectionIdを指定できません')
    const selection = db.prepare('SELECT company_id AS companyId FROM selection WHERE id = ?')
      .get(action.target.selectionId) as { companyId: number } | undefined
    if (!selection) issues.push(`選考トラックが正本DBにありません: ${action.target.selectionId}`)
    else if (companyId && selection.companyId !== companyId) issues.push('選考トラックと送信先企業が一致しません')
    if (mail?.selectionId && mail.selectionId !== action.target.selectionId) issues.push('元メールと指定した選考トラックが一致しません')
  }

  if (hasScheduleCommitmentLanguage(action) && action.content.scheduleCommitments.length === 0) {
    issues.push('日時を約束する文面なのにscheduleCommitmentsがありません')
  }
  for (const commitment of action.content.scheduleCommitments) {
    let excludeAppointmentId: number | undefined
    if (commitment.appointmentId !== undefined) {
      const appointment = db.prepare(`
        SELECT a.id, a.selection_id AS selectionId, s.company_id AS companyId,
               a.at AS startAt, a.end_at AS endAt, a.status
        FROM appointment a JOIN selection s ON s.id = a.selection_id WHERE a.id = ?
      `).get(commitment.appointmentId) as {
        id: number; selectionId: number; companyId: number; startAt: string; endAt: string; status: string
      } | undefined
      if (!appointment || appointment.status !== '予定' || appointment.companyId !== companyId
        || (action.target.selectionId && appointment.selectionId !== action.target.selectionId)
        || (mail?.selectionId && appointment.selectionId !== mail.selectionId)
        || Date.parse(appointment.startAt) !== Date.parse(commitment.startAt)
        || Date.parse(appointment.endAt) !== Date.parse(commitment.endAt)) {
        issues.push(`承諾対象の予定が企業・選考・日時と一致しません: ${commitment.appointmentId}`)
      } else {
        excludeAppointmentId = appointment.id
      }
    }
    const availability = getScheduleAvailability(db, commitment.startAt, commitment.endAt, {
      excludeAppointmentId,
      now: options.now,
      requireCanonical: true,
      requireCalendarFreshness: true,
    })
    schedule.push(availability)
    if (availability.state !== 'available' || !availability.available || availability.database.role !== 'canonical') {
      issues.push(`日時を確定できません: ${commitment.startAt}〜${commitment.endAt} (${availability.state})`)
    }
  }

  let attachmentBytes = 0
  for (const attachment of action.content.attachments ?? []) {
    if (!isAbsolute(attachment.path) || !existsSync(attachment.path)) {
      issues.push(`添付ファイルが見つかりません: ${attachment.filename}`)
      continue
    }
    const stats = statSync(attachment.path)
    if (!stats.isFile()) issues.push(`添付対象がファイルではありません: ${attachment.filename}`)
    attachmentBytes += stats.size
    if (/[\\/\r\n]/.test(attachment.filename) || !attachment.filename.trim()) issues.push('添付ファイル名が不正です')
    if (!/^[\w.+-]+\/[\w.+-]+$/i.test(attachment.mimeType)) issues.push(`添付MIME typeが不正です: ${attachment.filename}`)
  }
  if (attachmentBytes > 25 * 1024 * 1024) issues.push('添付ファイル合計が25MiBを超えています')

  return {
    ok: issues.length === 0,
    actionHash: workflowHash(action),
    database,
    companyId,
    mailItemId: mail?.id,
    issues: [...new Set(issues)],
    schedule,
  }
}

/**
 * 本人承認済みactionと完全一致するメールだけを専用adapterへ渡す。
 * 送信前後のどちらでも結果がunknownならrunをunknownで固定し、自動再送しない。
 */
export async function executeApprovedThirdPartyEmail(
  options: ExecuteApprovedEmailOptions,
): Promise<{ reconciled: boolean; receiptRef: string; actionHash: string }> {
  const { canonicalDb, workflowStore, contract, runId, action, adapter, now, identity } = options
  const target = getDatabaseContext(canonicalDb)
  const preflight = preflightThirdPartyEmail(canonicalDb, action, { now, identity })
  if (!preflight.ok) throw new Error(`メール送信前検査に失敗しました: ${preflight.issues.join(' / ')}`)

  beginWorkflowStep(workflowStore, contract, runId, 'send', 'executor', {
    input: action,
    capabilities: ['mail.read', 'mail.send.confirmed'],
    action,
    targetDatabase: target,
    now,
  })

  let output: { reconciled: boolean; receiptRef: string; actionHash: string }
  try {
    let delivery = await adapter.reconcile(action)
    let reconciled = delivery.state === 'sent'
    if (delivery.state === 'unknown') throw new Error('送信済み状態を確定できません')
    if (delivery.state === 'not_sent') {
      await adapter.send(action)
      delivery = await adapter.reconcile(action)
      reconciled = false
    }
    if (delivery.state !== 'sent' || !delivery.receiptRef?.trim()) {
      throw new Error('送信結果をSENT記録へ結び付けられません')
    }

    output = { reconciled, receiptRef: delivery.receiptRef, actionHash: preflight.actionHash }
    completeWorkflowStep(workflowStore, contract, runId, 'send', 'executor', {
      output,
      outputRef: delivery.receiptRef,
      action,
      targetDatabase: target,
      now,
    })
  } catch {
    try {
      failWorkflowStep(
        workflowStore,
        contract,
        runId,
        'send',
        'executor',
        'unknown',
        '送信結果を確定できません。SENT・宛先・件名・本文を照合するまで再送しないでください',
        now,
      )
    } catch {
      // 元のrun状態を優先する。
    }
    throw new Error('メール送信結果を確定できません。送信済みを照合するまで再送しません')
  }

  // send完了後の監査失敗は「送信不明」へ戻さない。承認は既に消費済みで、再送は禁止のまま。
  try {
    beginWorkflowStep(workflowStore, contract, runId, 'audit', 'executor', { targetDatabase: target, now })
    completeWorkflowStep(workflowStore, contract, runId, 'audit', 'executor', {
      output,
      outputRef: output.receiptRef,
      targetDatabase: target,
      now,
    })
  } catch {
    try {
      failWorkflowStep(
        workflowStore,
        contract,
        runId,
        'audit',
        'executor',
        'failed',
        'メール送信はSENTで確認済みですが、監査記録を完了できませんでした',
        now,
      )
    } catch {
      // 送信完了記録と承認消費を維持する。
    }
    throw new Error('メールは送信済みですが、監査記録を完了できませんでした。再送しないでください')
  }
  return output
}
