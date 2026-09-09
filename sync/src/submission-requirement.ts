import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { resolveCompany } from './db'
import { resolveSelectionId, transaction } from './inputs'

export const REQUIREMENT_KINDS = [
  'pledge',
  'insurance_certificate',
  'self_intro',
  'es',
  'assessment',
  'survey',
  'setup',
  'identity_document',
  'expense_document',
  'other',
] as const

export type RequirementKind = typeof REQUIREMENT_KINDS[number]
export type RequirementStatus = 'required' | 'completed' | 'waived'
export type PreparationStatus = 'not_started' | 'researching' | 'ready_for_approval' | 'blocked' | 'done'

export interface SubmissionRequirementInput {
  sourceRef: string
  company: string
  position?: string
  kind: RequirementKind | string
  title: string
  deadline?: string
  actionUrl?: string
  instructions?: string
  status: RequirementStatus
}

export interface SubmissionRequirementRow {
  id: number
  logicalKey: string
  selectionId: number | null
  companyId: number | null
  company: string
  position: string
  kind: RequirementKind
  title: string
  deadline: string
  actionUrl: string
  instructions: string
  sourceRef: string
  status: RequirementStatus
  preparationStatus: PreparationStatus
  preparationRef: string
  blocker: string
  completionRef: string
  firstSeenAt: string
  updatedAt: string
  completedAt: string
}

function compact(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

export function normalizeRequirementKind(value: string): RequirementKind {
  const normalized = compact(value)
  if (REQUIREMENT_KINDS.includes(value as RequirementKind)) return value as RequirementKind
  if (/保険|学研災|学研賠|insurance/.test(normalized)) return 'insurance_certificate'
  if (/誓約|pledge/.test(normalized)) return 'pledge'
  if (/自己紹介|selfintro|introduction/.test(normalized)) return 'self_intro'
  if (/エントリーシート|es/.test(normalized)) return 'es'
  if (/適性|webtest|assessment|テスト/.test(normalized)) return 'assessment'
  if (/アンケート|survey/.test(normalized)) return 'survey'
  if (/本人確認|身分証|identity|マイナンバー/.test(normalized)) return 'identity_document'
  if (/領収|精算|expense/.test(normalized)) return 'expense_document'
  if (/設定|セットアップ|登録|setup/.test(normalized)) return 'setup'
  return 'other'
}

function logicalKey(parts: Array<string | number | null | undefined>): string {
  return createHash('sha256').update(parts.map((part) => compact(String(part ?? ''))).join('|')).digest('hex')
}

function resolveLinks(
  db: DatabaseSync,
  input: SubmissionRequirementInput,
): { companyId: number | null; selectionId: number | null; position: string } {
  let companyId: number | null = null
  let selectionId: number | null = null
  let position = input.position?.trim() ?? ''
  const company = resolveCompany(db, input.company)
  if (company.kind === 'hit') companyId = company.companyId
  if (company.kind !== 'suspicious') {
    try {
      const resolved = resolveSelectionId(db, input.company, input.position)
      companyId = resolved.companyId
      selectionId = resolved.selectionId
      const row = db.prepare('SELECT position FROM selection WHERE id = ?').get(selectionId) as { position: string } | undefined
      if (!position) position = row?.position ?? ''
    } catch {
      // company_idだけでも台帳化できる。複数トラックを推測で結び付けない。
    }
  }
  return { companyId, selectionId, position }
}

export function applySubmissionRequirements(
  db: DatabaseSync,
  inputs: SubmissionRequirementInput[],
  now: Date = new Date(),
): { created: number; updated: number; completed: number } {
  return transaction(db, () => {
    const summary = { created: 0, updated: 0, completed: 0 }
    const at = now.toISOString()
    for (const input of inputs) {
      if (!input.sourceRef || !input.company || !input.title) throw new Error('提出物は sourceRef/company/title が必須です')
      if (!['required', 'completed', 'waived'].includes(input.status)) throw new Error(`不正な提出物status: ${input.status}`)
      const kind = normalizeRequirementKind(input.kind || input.title)
      const links = resolveLinks(db, input)
      const key = logicalKey([
        links.selectionId ? `selection:${links.selectionId}` : `company:${links.companyId ?? input.company}`,
        links.position,
        kind,
      ])

      // 会社だけで先に記録した行へ、後からselectionを解決できた場合も同じ未完了タスクとして昇格する。
      const prior = (db.prepare(`
        SELECT id, logical_key AS logicalKey, status
        FROM submission_requirement
        WHERE logical_key = ?
           OR (status = 'required' AND kind = ? AND company_id IS ?
               AND (selection_id IS ? OR selection_id IS NULL OR ? IS NULL))
        ORDER BY CASE WHEN logical_key = ? THEN 0 ELSE 1 END, id DESC
        LIMIT 1
      `).get(key, kind, links.companyId, links.selectionId, links.selectionId, key) as {
        id: number
        logicalKey: string
        status: RequirementStatus
      } | undefined)

      if (prior) {
        // 古い依頼メールの再取得で、根拠付きcompleted/waivedをrequiredへ巻き戻さない。
        const nextStatus: RequirementStatus =
          prior.status !== 'required' && input.status === 'required' ? prior.status : input.status
        const terminal = nextStatus === 'completed' || nextStatus === 'waived'
        const newlyTerminal = input.status === 'completed' || input.status === 'waived'
        db.prepare(`
          UPDATE submission_requirement SET
            logical_key = ?,
            selection_id = COALESCE(?, selection_id),
            company_id = COALESCE(?, company_id),
            title = CASE WHEN ? <> '' THEN ? ELSE title END,
            deadline = CASE WHEN ? <> '' THEN ? ELSE deadline END,
            action_url = CASE WHEN ? <> '' THEN ? ELSE action_url END,
            instructions = CASE WHEN ? <> '' THEN ? ELSE instructions END,
            source_ref = ?,
            status = ?,
            preparation_status = CASE WHEN ? THEN 'done' ELSE preparation_status END,
            completion_ref = CASE WHEN ? THEN ? ELSE completion_ref END,
            completed_at = CASE WHEN ? THEN ? ELSE completed_at END,
            updated_at = ?
          WHERE id = ?
        `).run(
          key, links.selectionId, links.companyId,
          input.title, input.title,
          input.deadline ?? '', input.deadline ?? '',
          input.actionUrl ?? '', input.actionUrl ?? '',
          input.instructions ?? '', input.instructions ?? '',
          input.sourceRef, nextStatus,
          terminal ? 1 : 0,
          newlyTerminal ? 1 : 0, newlyTerminal ? input.sourceRef : '',
          newlyTerminal ? 1 : 0, newlyTerminal ? at : '',
          at, prior.id,
        )
        summary.updated += 1
        if (newlyTerminal && prior.status === 'required') summary.completed += 1
      } else {
        const terminal = input.status === 'completed' || input.status === 'waived'
        db.prepare(`
          INSERT INTO submission_requirement
            (logical_key, selection_id, company_id, kind, title, deadline, action_url, instructions,
             source_ref, status, preparation_status, completion_ref, first_seen_at, updated_at, completed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          key, links.selectionId, links.companyId, kind, input.title, input.deadline ?? '',
          input.actionUrl ?? '', input.instructions ?? '', input.sourceRef, input.status,
          terminal ? 'done' : 'not_started', terminal ? input.sourceRef : '', at, at, terminal ? at : '',
        )
        summary.created += 1
        if (terminal) summary.completed += 1
      }
    }
    return summary
  })
}

export function listSubmissionRequirements(
  db: DatabaseSync,
  opts: { openOnly?: boolean } = {},
): SubmissionRequirementRow[] {
  const where = opts.openOnly ? "WHERE r.status = 'required'" : ''
  return db.prepare(`
    SELECT r.id, r.logical_key AS logicalKey, r.selection_id AS selectionId,
           r.company_id AS companyId, COALESCE(c.name, '') AS company,
           COALESCE(s.position, '') AS position, r.kind, r.title, r.deadline,
           r.action_url AS actionUrl, r.instructions, r.source_ref AS sourceRef,
           r.status, r.preparation_status AS preparationStatus,
           r.preparation_ref AS preparationRef, r.blocker, r.completion_ref AS completionRef,
           r.first_seen_at AS firstSeenAt, r.updated_at AS updatedAt, r.completed_at AS completedAt
    FROM submission_requirement r
    LEFT JOIN company c ON c.id = r.company_id
    LEFT JOIN selection s ON s.id = r.selection_id
    ${where}
    ORDER BY CASE WHEN r.deadline = '' THEN 1 ELSE 0 END, r.deadline, r.id
  `).all() as SubmissionRequirementRow[]
}

export function setRequirementPreparation(
  db: DatabaseSync,
  id: number,
  status: Exclude<PreparationStatus, 'done'>,
  detail: { preparationRef?: string; blocker?: string } = {},
  now: Date = new Date(),
): void {
  const result = db.prepare(`
    UPDATE submission_requirement
    SET preparation_status = ?, preparation_ref = ?, blocker = ?, updated_at = ?
    WHERE id = ? AND status = 'required'
  `).run(status, detail.preparationRef ?? '', detail.blocker ?? '', now.toISOString(), id)
  if (result.changes !== 1) throw new Error(`未完了の提出物が見つかりません: id=${id}`)
}

export function completeRequirement(
  db: DatabaseSync,
  id: number,
  completionRef: string,
  now: Date = new Date(),
): void {
  const result = db.prepare(`
    UPDATE submission_requirement
    SET status = 'completed', preparation_status = 'done', completion_ref = ?,
        completed_at = ?, updated_at = ?, blocker = ''
    WHERE id = ? AND status = 'required'
  `).run(completionRef, now.toISOString(), now.toISOString(), id)
  if (result.changes !== 1) throw new Error(`未完了の提出物が見つかりません: id=${id}`)
}

/** submission台帳へ提出根拠が入った時、同じ選考・種別の未完了要求だけを決定論的に閉じる。 */
export function completeMatchingRequirement(
  db: DatabaseSync,
  selectionId: number,
  kindValue: string,
  completionRef: string,
  now: Date = new Date(),
): number {
  const kind = normalizeRequirementKind(kindValue)
  const at = now.toISOString()
  const result = db.prepare(`
    UPDATE submission_requirement
    SET status = 'completed', preparation_status = 'done', completion_ref = ?,
        completed_at = ?, updated_at = ?, blocker = ''
    WHERE selection_id = ? AND kind = ? AND status = 'required'
  `).run(completionRef, at, at, selectionId, kind)
  return Number(result.changes)
}
