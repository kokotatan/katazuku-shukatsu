/**
 * Gmail抽出結果をInbox用mail_itemへ冪等反映する。
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DatabaseSync } from 'node:sqlite'
import { openDb, resolveCompany } from '../src/db'
import { resolveSelectionId, transaction } from '../src/inputs'
import { resolveDatabasePath } from '../src/database-path'

interface MailItem {
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
interface MailInput { items: MailItem[] }
const dbArgIndex = process.argv.indexOf('--db')
const DB_PATH = resolveDatabasePath(dbArgIndex >= 0 ? process.argv[dbArgIndex + 1] : undefined)

function validate(value: unknown): asserts value is MailInput {
  if (!value || typeof value !== 'object' || !Array.isArray((value as MailInput).items)) throw new Error('入力は {items:[...]} 形式です')
  for (const [index, item] of (value as MailInput).items.entries()) {
    if (!item.id || !item.receivedAt || !item.subject) throw new Error(`items[${index}] は id/receivedAt/subject が必須です`)
  }
}

export function applyMail(input: MailInput, db: DatabaseSync = openDb(DB_PATH)): { created: number; updated: number } {
  return transaction(db, () => {
    const result = { created: 0, updated: 0 }
    for (const item of input.items) {
      let selectionId: number | null = null
      let companyId: number | null = null
      if (item.company) {
        const resolution = resolveCompany(db, item.company)
        if (resolution.kind !== 'suspicious') {
          // メールは company_id があれば足りる。selection_id は一意に特定できた時だけ付ける。
          // 複数トラックで position が無い等で特定できなくても、そのメール1件で日次同期全体を
          // 止めない(提出物の失敗隔離と同じ方針)。company_id は hit していれば必ず残す。
          try {
            const resolved = resolveSelectionId(db, item.company, item.position)
            selectionId = resolved.selectionId
            companyId = resolved.companyId
          } catch {
            if (resolution.kind === 'hit') companyId = resolution.companyId
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

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && currentFile === resolve(process.argv[1])) {
  const file = process.argv[2]
  if (!file) throw new Error('使い方: npx tsx scripts/db-apply-mail.ts <mail.json>')
  const input: unknown = JSON.parse(readFileSync(resolve(file), 'utf8'))
  validate(input)
  console.log(JSON.stringify(applyMail(input), null, 2))
}
