/**
 * DBにあり、まだ外部カレンダーへ反映されていない予定をJSONで出す(読み取り専用)。
 * カレンダー作成後は scripts/db-link-calendar.ts で外部IDを戻す。
 *   npx tsx scripts/db-calendar-outbox.ts [--db <path>]
 */
import { listCalendarOutbox } from '../src/application.js'
import { openDb } from '../src/db.js'
import { resolveDatabasePath } from '../src/database-path.js'

const dbIndex = process.argv.indexOf('--db')
const db = openDb(resolveDatabasePath(dbIndex >= 0 ? process.argv[dbIndex + 1] : undefined))
try {
  console.log(JSON.stringify({ appointments: listCalendarOutbox(db) }, null, 2))
} finally {
  db.close()
}
