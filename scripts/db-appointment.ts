/**
 * 予定(appointment)の点検・空き判定・中止。
 *   npx tsx scripts/db-appointment.ts list [YYYY-MM-DD]            … 予定一覧(省略時は今後30件)
 *   npx tsx scripts/db-appointment.ts conflicts <開始ISO> <終了ISO> … 空き判定(available / conflict / unknown)
 *   npx tsx scripts/db-appointment.ts move <id> <開始ISO> <終了ISO>  … カレンダー未反映の可動タスクだけ移動
 *   npx tsx scripts/db-appointment.ts cancel <id> [理由]            … status を「中止」にする(削除はしない)
 *
 * conflicts は情報不足(カレンダー同期が古い・期間を覆っていない)を「空き」と誤認しない。unknown は候補に使わない。
 * 終了コード: 0=available / 2=conflict / 3=unknown
 */
import { addEvent, openDb } from '../src/db.js'
import { resolveDatabasePath } from '../src/database-path.js'
import { getScheduleAvailability } from '../src/schedule.js'

const db = openDb(resolveDatabasePath())
const [command, a1, a2, a3] = process.argv.slice(2)

try {
  if (command === 'conflicts') {
    if (!a1 || !a2) throw new Error('使い方: db-appointment.ts conflicts <start-iso> <end-iso> [除外する予定id]')
    const availability = getScheduleAvailability(db, a1, a2, { excludeAppointmentId: a3 ? Number(a3) : undefined })
    console.log(JSON.stringify(availability, null, 2))
    if (availability.state === 'conflict') process.exitCode = 2
    if (availability.state === 'unknown') process.exitCode = 3
  } else if (command === 'move') {
    const id = Number(a1)
    const startMs = Date.parse(a2 || '')
    const endMs = Date.parse(a3 || '')
    if (!Number.isInteger(id) || Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
      throw new Error('使い方: db-appointment.ts move <id> <start-iso> <end-iso>')
    }
    const row = db.prepare('SELECT id, selection_id AS selectionId, title, flexible, external_id AS externalId FROM appointment WHERE id = ?')
      .get(id) as { selectionId: number; title: string; flexible: number; externalId: string } | undefined
    if (!row) throw new Error(`予定が見つかりません: #${id}`)
    if (row.flexible !== 1) throw new Error(`固定予定は move できません: #${id}`)
    if (row.externalId) throw new Error(`カレンダー反映済みです。外部予定を先に移動し、calendar-sync でDBへ戻してください: #${id}`)
    db.prepare('UPDATE appointment SET at = ?, end_at = ? WHERE id = ?').run(new Date(startMs).toISOString(), new Date(endMs).toISOString(), id)
    addEvent(db, row.selectionId, '予定更新', `${row.title}を空き時間へ移動`, 'db-appointment')
    console.log(JSON.stringify({ moved: true, appointmentId: id }))
  } else if (command === 'cancel') {
    const id = Number(a1)
    if (!Number.isInteger(id)) throw new Error('使い方: db-appointment.ts cancel <id> [理由]')
    const row = db.prepare('SELECT at, title, selection_id AS selectionId FROM appointment WHERE id = ?')
      .get(id) as { at: string; title: string; selectionId: number } | undefined
    if (!row) throw new Error(`予定が見つかりません: #${id}`)
    db.prepare("UPDATE appointment SET status = '中止' WHERE id = ?").run(id)
    addEvent(db, row.selectionId, '予定更新', `予定を中止: ${row.title}(${row.at})${a2 ? ' 理由: ' + a2 : ''}`, 'db-appointment')
    console.log(`中止にしました: #${id} ${row.title} (${row.at})`)
  } else {
    const date = command === 'list' ? a1 : command
    const rows = (date
      ? db.prepare(`
          SELECT a.id, a.at, a.kind, a.title, a.status, a.flexible, c.name AS company
          FROM appointment a JOIN selection s ON s.id = a.selection_id JOIN company c ON c.id = s.company_id
          WHERE a.at LIKE ? || '%' ORDER BY a.at LIMIT 30`).all(date)
      : db.prepare(`
          SELECT a.id, a.at, a.kind, a.title, a.status, a.flexible, c.name AS company
          FROM appointment a JOIN selection s ON s.id = a.selection_id JOIN company c ON c.id = s.company_id
          WHERE a.at >= ? AND a.status = '予定' ORDER BY a.at LIMIT 30`).all(new Date().toISOString())) as Record<string, unknown>[]
    for (const row of rows) {
      console.log(`#${row.id} ${row.at} | ${row.kind} | ${row.company} | ${row.title} | ${row.status}${row.flexible ? ' | 時間変更可' : ''}`)
    }
    console.log(`--- ${rows.length}件`)
  }
} finally {
  db.close()
}
