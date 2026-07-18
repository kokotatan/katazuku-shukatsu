/**
 * 外部カレンダーに作成した予定IDをappointmentへ戻す。
 * 入力: {"links":[{"appointmentId":1,"externalId":"...","calendarId":"..."}]}
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { linkCalendarAppointment, type CalendarLinkInput } from '../src/application'
import { openDb } from '../src/db'

interface LinkInput {
  links: CalendarLinkInput[]
}

const dbArgIndex = process.argv.indexOf('--db')
const DB_PATH = dbArgIndex >= 0
  ? resolve(process.argv[dbArgIndex + 1])
  : (process.env.KATAZUKU_DB_PATH || join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'katazuku.db'))

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && currentFile === resolve(process.argv[1])) {
  const file = process.argv[2]
  if (!file) throw new Error('使い方: npx tsx scripts/db-link-calendar.ts <links.json> [--db <path>]')
  const input = JSON.parse(readFileSync(resolve(file), 'utf8')) as LinkInput
  if (!Array.isArray(input.links)) throw new Error('入力は {links:[...]} 形式です')
  const db = openDb(DB_PATH)
  try {
    console.log(JSON.stringify(input.links.map((link) => linkCalendarAppointment(db, link)), null, 2))
  } finally {
    db.close()
  }
}
