/**
 * メール抽出結果をInbox用 mail_item へ冪等反映する(本文は保存しない。要約とカテゴリだけ)。
 * 募集案内を保存しただけで応募先・選考中トラックを作らない(resolveSelectionId の create=false)。
 */
import type { DatabaseSync } from 'node:sqlite'
import { resolveCompany } from './db.js'
import { resolveSelectionId, transaction } from './inputs.js'

export interface MailApplyItem {
  id: string
  receivedAt: string
  sender?: string
  subject: string
  summary?: string
  category?: string
  needsAction?: boolean
  deadline?: string
  status?: string
  company?: string
  position?: string
  sourceRef?: string
}

export function applyMail(db: DatabaseSync, input: { items: MailApplyItem[] }): { created: number; updated: number } {
  for (const [index, item] of input.items.entries()) {
    if (!item.id || !item.receivedAt || !item.subject) throw new Error(`items[${index}] は id/receivedAt/subject が必須です`)
  }
  return transaction(db, () => {
    const result = { created: 0, updated: 0 }
    for (const item of input.items) {
      let selectionId: number | null = null
      let companyId: number | null = null
      if (item.company) {
        const resolution = resolveCompany(db, item.company)
        if (resolution.kind === 'hit') {
          // selection_id は一意に特定できた時だけ付ける。複数トラックで position が無い等で
          // 特定できなくても、そのメール1件で日次同期全体を止めない。
          try {
            const resolved = resolveSelectionId(db, item.company, item.position, false)
            selectionId = resolved.selectionId
            companyId = resolved.companyId
          } catch {
            companyId = resolution.companyId
          }
        }
      }
      const prior = db.prepare('SELECT id FROM mail_item WHERE id = ?').get(item.id)
      db.prepare(`
        INSERT INTO mail_item
          (id, selection_id, company_id, received_at, sender, subject, summary, category,
           needs_action, deadline, status, source_ref, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          selection_id = COALESCE(excluded.selection_id, mail_item.selection_id),
          company_id = COALESCE(excluded.company_id, mail_item.company_id),
          received_at = excluded.received_at, sender = excluded.sender,
          subject = excluded.subject, summary = excluded.summary, category = excluded.category,
          needs_action = excluded.needs_action, deadline = excluded.deadline,
          status = excluded.status, source_ref = excluded.source_ref
      `).run(
        item.id, selectionId, companyId, item.receivedAt, item.sender || '', item.subject,
        item.summary || '', item.category || 'その他', item.needsAction ? 1 : 0,
        item.deadline || '', item.status || '未確認', item.sourceRef || item.id,
        new Date().toISOString(),
      )
      if (prior) result.updated += 1
      else result.created += 1
    }
    return result
  })
}
