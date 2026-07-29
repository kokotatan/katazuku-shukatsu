/**
 * 予定(appointment)の点検と中止。日程変更で古い予定が残ったときの消し込みに使う。
 *   cd sync && npx tsx scripts/db-appointment.ts list [YYYY-MM-DD]  … その日の予定一覧(省略時は今日以降10件)
 *   cd sync && npx tsx scripts/db-appointment.ts cancel <id> <理由>  … statusを「中止」にする(削除はしない)
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { openDb, addEvent } from '../src/db'

const DB_PATH = process.env.KATAZUKU_DB ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'katazuku.db')
const db = openDb(DB_PATH)
const [cmd, a1, a2] = process.argv.slice(2)

type Row = Record<string, unknown>

if (cmd === 'cancel') {
  const id = Number(a1)
  if (!Number.isInteger(id)) {
    console.error('usage: db-appointment.ts cancel <id> <理由>')
    process.exit(1)
  }
  const appt = db.prepare(
    'SELECT a.id, a.at, a.title, a.status, a.selection_id FROM appointment a WHERE a.id = ?',
  ).get(id) as Row | undefined
  if (!appt) {
    console.error(`予定が見つかりません: #${id}`)
    process.exit(1)
  }
  db.prepare("UPDATE appointment SET status = '中止' WHERE id = ?").run(id)
  addEvent(
    db,
    Number(appt.selection_id),
    '予定更新',
    `予定を中止: ${appt.title}(${appt.at})${a2 ? ' 理由: ' + a2 : ''}`,
    'db-appointment',
  )
  console.log(`中止にしました: #${id} ${appt.title} (${appt.at})`)
} else {
  const date = cmd === 'list' ? a1 : cmd
  const rows = db.prepare(`
    SELECT a.id, a.at, a.kind, a.title, a.status, c.name company
    FROM appointment a
    JOIN selection s ON s.id = a.selection_id
    JOIN company c ON c.id = s.company_id
    ${date ? "WHERE a.at LIKE ? || '%'" : "WHERE a.at >= datetime('now') AND a.status = '予定'"}
    ORDER BY a.at LIMIT 30
  `).all(...(date ? [date] : [])) as Row[]
  for (const r of rows) console.log(`#${r.id} ${r.at} | ${r.kind} | ${r.company} | ${r.title} | ${r.status}`)
  console.log(`--- ${rows.length}件`)
}
