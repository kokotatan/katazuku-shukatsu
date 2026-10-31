import type { DatabaseSync } from 'node:sqlite'
import { addEvent, outcomeOf, resolveCompany, transition } from './db.js'

export const COMPANY_EXCLUSION_MARKER = '[就活管理対象外]'

export interface CompanyExclusionInput {
  name: string
  reason: string
  ref: string
}

/** 本人が対象外にした企業は、後続メールやカレンダーから選考・予定を再生成しない。 */
export function isCompanyExcluded(db: DatabaseSync, name: string): boolean {
  const resolved = resolveCompany(db, name)
  if (resolved.kind !== 'hit') return false
  const row = db.prepare('SELECT memo FROM company WHERE id = ?').get(resolved.companyId) as { memo: string } | undefined
  return Boolean(row?.memo.includes(COMPANY_EXCLUSION_MARKER))
}

/** 本人の対象外指示を正本へ記録し、既存トラックとローカル予定を止める。外部カレンダーは変更しない。 */
export function excludeCompany(
  db: DatabaseSync,
  input: CompanyExclusionInput,
  now: Date = new Date(),
): { companyId: number; selections: number; appointments: number } {
  const name = input?.name?.trim()
  const reason = input?.reason?.trim()
  const ref = input?.ref?.trim()
  if (!name || !reason || !ref) throw new Error('name/reason/ref は必須です')
  if (name.length > 200 || reason.length > 1_000 || ref.length > 500) throw new Error('対象外指示が長すぎます')

  const resolved = resolveCompany(db, name)
  if (resolved.kind !== 'hit') throw new Error(`既存企業を一意に特定できません: ${name}`)
  const companyId = resolved.companyId
  const at = now.toISOString()

  db.exec('BEGIN IMMEDIATE')
  try {
    const company = db.prepare('SELECT memo FROM company WHERE id = ?').get(companyId) as { memo: string }
    if (!company.memo.includes(COMPANY_EXCLUSION_MARKER)) {
      const memo = [company.memo.trim(), `${COMPANY_EXCLUSION_MARKER} ${reason}`].filter(Boolean).join('\n')
      db.prepare('UPDATE company SET memo = ?, updated_at = ? WHERE id = ?').run(memo, at, companyId)
    }

    const selections = db.prepare('SELECT id, status, next_action, next_date FROM selection WHERE company_id = ?')
      .all(companyId) as { id: number; status: string; next_action: string; next_date: string }[]
    let changedSelections = 0
    let cancelledAppointments = 0
    for (const selection of selections) {
      const nextStatus = transition(selection.status, 'closed')
      const nextAction = `本人意思で就活管理対象外: ${reason}`
      if (nextStatus || selection.next_action !== nextAction || selection.next_date) {
        const status = nextStatus ?? selection.status
        db.prepare(`
          UPDATE selection SET status = ?, outcome = ?, next_action = ?, next_date = '', updated_at = ?, updated_by = 'conversation'
          WHERE id = ?
        `).run(status, outcomeOf(status), nextAction, at, selection.id)
        addEvent(db, selection.id, '状態変化', `${selection.status} → ${status}; ${nextAction}`, 'conversation', at, ref)
        changedSelections++
      }
      const appointments = db.prepare("SELECT id, title FROM appointment WHERE selection_id = ? AND status = '予定'")
        .all(selection.id) as { id: number; title: string }[]
      for (const appointment of appointments) {
        db.prepare("UPDATE appointment SET status = '中止' WHERE id = ?").run(appointment.id)
        addEvent(db, selection.id, '予定更新', `本人意思で予定を中止: ${appointment.title}`, 'conversation', at, ref)
        cancelledAppointments++
      }
    }
    db.exec('COMMIT')
    return { companyId, selections: changedSelections, appointments: cancelledAppointments }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
