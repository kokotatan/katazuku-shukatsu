/**
 * 外部カレンダーに作成(または再利用)した予定IDを appointment へ戻す。
 *   npx tsx scripts/db-link-calendar.ts <links.json> [--db <path>]
 * 入力: {"links":[{"appointmentId":1,"externalId":"...","calendarId":"..."}]}
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { linkCalendarAppointment, type CalendarLinkInput } from '../src/application.js'
import { openDb } from '../src/db.js'
import { resolveDatabasePath } from '../src/database-path.js'

const file = process.argv[2]
if (!file || file.startsWith('--')) throw new Error('使い方: npx tsx scripts/db-link-calendar.ts <links.json> [--db <path>]')
const input = JSON.parse(readFileSync(resolve(file), 'utf8').replace(/^﻿/, '')) as { links?: CalendarLinkInput[] }
if (!Array.isArray(input.links)) throw new Error('入力は {links:[...]} 形式です')
const dbIndex = process.argv.indexOf('--db')
const db = openDb(resolveDatabasePath(dbIndex >= 0 ? process.argv[dbIndex + 1] : undefined))
try {
  console.log(JSON.stringify(input.links.map((link) => linkCalendarAppointment(db, link)), null, 2))
} finally {
  db.close()
}
