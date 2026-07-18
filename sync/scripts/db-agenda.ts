/**
 * 会議自動運転の司令情報: 直近の「予定」ステータスのappointmentをJSONで出す。
 * meeting-autopilot.ps1 が5分毎にこれを読み、開く/録る/締めるを判断する(正はDBのみ。カレンダーは見ない)。
 * 実行: cd sync && npx tsx scripts/db-agenda.ts
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { openDb, listAppointments } from '../src/db'

const DB_PATH = process.env.KATAZUKU_DB ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'katazuku.db')
const db = openDb(DB_PATH)

const now = Date.now()
const H = 3600_000
const items = listAppointments(db)
  .filter((a) => a.status === '予定')
  .filter((a) => a.kind !== '締切') // 締切は「時間に参加する」ものではないので開く/録るの対象外
  .map((a) => {
    const start = Date.parse(a.at.replace(/\//g, '-'))
    if (isNaN(start)) return null
    const end = a.endAt ? Date.parse(a.endAt.replace(/\//g, '-')) : start + H
    return {
      id: a.id,
      company: a.company,
      title: a.title,
      kind: a.kind,
      url: a.url,
      person: a.person,
      startIso: new Date(start).toISOString(),
      endIso: new Date(isNaN(end) ? start + H : end).toISOString(),
    }
  })
  .filter((a): a is NonNullable<typeof a> => a !== null)
  // 直近2時間前〜48時間先だけが司令対象
  .filter((a) => Date.parse(a.startIso) > now - 2 * H && Date.parse(a.startIso) < now + 48 * H)

console.log(JSON.stringify(items))
