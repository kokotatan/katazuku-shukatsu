/**
 * 会議終了の後始末: appointmentを「完了」にし、面接実施イベントを刻む。
 * meeting-autopilot.ps1 が終了時刻+4分に呼ぶ。実行後はdb-snapshotで即アプリへ反映される。
 * 実行: cd sync && npx tsx scripts/db-meeting-done.ts <appointmentId>
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { openDb, addEvent } from '../src/db'

const DB_PATH = process.env.KATAZUKU_DB ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'katazuku.db')
const id = Number(process.argv[2])
if (!id) {
  console.error('使い方: npx tsx scripts/db-meeting-done.ts <appointmentId>')
  process.exit(1)
}
const db = openDb(DB_PATH)
const ap = db.prepare('SELECT selection_id, title, at, status FROM appointment WHERE id = ?').get(id) as
  | { selection_id: number; title: string; at: string; status: string }
  | undefined
if (!ap) {
  console.error(`appointment ${id} が見つかりません`)
  process.exit(1)
}
if (ap.status === '完了') {
  console.log(`appointment ${id} は既に完了(冪等)`)
} else {
  db.prepare("UPDATE appointment SET status = '完了' WHERE id = ?").run(id)
  addEvent(db, ap.selection_id, '面接実施', `${ap.title} を実施(${ap.at})。録音→議事録は自動生成中`, 'meeting-autopilot', undefined, `appointment:${id}`)
  console.log(`完了: ${ap.title} (${ap.at})`)
}
