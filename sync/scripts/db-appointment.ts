/**
 * 予定(appointment)の点検と中止。日程変更で古い予定が残ったときの消し込みに使う。
 *   cd sync && npx tsx scripts/db-appointment.ts list [YYYY-MM-DD]  … その日の予定一覧(省略時は今日以降10件)
 *   cd sync && npx tsx scripts/db-appointment.ts conflicts <開始ISO> <終了ISO> … 正本・同期鮮度込みの空き判定
 *   cd sync && npx tsx scripts/db-appointment.ts cancel <id> <理由>  … statusを「中止」にする(削除はしない)
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { openDb, addEvent, getDatabaseContext, type DatabaseRole } from '../src/db'
import { getScheduleAvailability } from '../src/schedule'
import { resolveDatabasePath } from '../src/database-path'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DB_PATH = resolveDatabasePath()
const configuredRole = process.env.KATAZUKU_DB_ROLE
const DB_ROLE: DatabaseRole = configuredRole === 'canonical' || configuredRole === 'replica' || configuredRole === 'fixture'
  ? configuredRole
  : existsSync(join(REPO, '.katazuku-satellite')) ? 'replica' : 'canonical'
const db = openDb(DB_PATH)
const [cmd, a1, a2, a3] = process.argv.slice(2)

type Row = Record<string, unknown>

if (cmd === 'conflicts') {
  if (!a1 || !a2) {
    console.error('usage: db-appointment.ts conflicts <start-iso> <end-iso> [exclude-id]')
    process.exit(1)
  }
  const availability = getScheduleAvailability(db, a1, a2, {
    excludeAppointmentId: a3 ? Number(a3) : undefined,
    databaseRole: DB_ROLE,
  })
  console.log(JSON.stringify(availability, null, 2))
  if (availability.state === 'conflict') process.exitCode = 2
  if (availability.state === 'unknown') process.exitCode = 3
} else if (cmd === 'context') {
  console.log(JSON.stringify(getDatabaseContext(db, DB_ROLE), null, 2))
} else if (cmd === 'cancel') {
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
  if (a3) {
    const now = new Date().toISOString()
    db.prepare(`
      UPDATE selection
      SET next_action = ?, next_date = '', updated_at = ?, updated_by = 'db-appointment'
      WHERE id = ?
    `).run(a3, now, Number(appt.selection_id))
    addEvent(
      db,
      Number(appt.selection_id),
      '予定更新',
      `次アクション: ${a3}`,
      'db-appointment',
    )
  }
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
