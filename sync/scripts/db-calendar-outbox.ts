/**
 * DBにあり、まだ外部カレンダーへ反映されていない予定をJSONで出力する。
 * 読み取り専用。カレンダー作成後は db-link-calendar.ts で外部IDを戻す。
 */
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listCalendarOutbox } from '../src/application'
import { openDb } from '../src/db'
import { resolveDatabasePath } from '../src/database-path'

const dbArgIndex = process.argv.indexOf('--db')
const DB_PATH = resolveDatabasePath(dbArgIndex >= 0 ? process.argv[dbArgIndex + 1] : undefined)

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && currentFile === resolve(process.argv[1])) {
  const db = openDb(DB_PATH)
  try {
    console.log(JSON.stringify({ appointments: listCalendarOutbox(db) }, null, 2))
  } finally {
    db.close()
  }
}
