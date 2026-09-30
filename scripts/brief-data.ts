/**
 * 前夜ブリーフ用のデータ集約: 指定日(既定=明日)の面接・面談・説明会・テストについて、
 * 会社・選考状況・相手(人物+メモ)・過去の面接記録・直近の出来事をJSONで出す。
 *   npx tsx scripts/brief-data.ts [YYYY-MM-DD]
 * 出力は stdout のJSONだけ(個人データを含むためファイルへは書かない)。
 */
import { resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { openDb } from '../src/db.js'
import { resolveDatabasePath } from '../src/database-path.js'
import { loadConfig } from '../src/katazuku-config.js'
import { utcOffsetFor } from './calendar-fetch.js'

type Row = Record<string, unknown>

/** タイムゾーン上の日付 YYYY-MM-DD(offsetDays 日後) */
export function localDate(timeZone: string, offsetDays = 0, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(now.getTime() + offsetDays * 86_400_000))
}

/**
 * appointment.at はUTCのISOで保存されている。日付の文字列一致(LIKE)で引くと、
 * 日本時間の朝の予定が前日扱いになる。ローカル日付の範囲[00:00, 翌00:00)をUTCへ直して比べる。
 */
export function dayRange(date: string, utcOffset: string): { from: string; until: string } {
  const start = Date.parse(`${date}T00:00:00${utcOffset}`)
  if (Number.isNaN(start)) throw new Error(`日付が不正です: ${date}`)
  return { from: new Date(start).toISOString(), until: new Date(start + 86_400_000).toISOString() }
}

export function getBriefData(db: DatabaseSync, date: string, utcOffset: string): { date: string; count: number; appointments: Row[] } {
  const range = dayRange(date, utcOffset)
  const appointments = db.prepare(`
    SELECT a.id, a.at, a.end_at AS endAt, a.kind, a.title, a.url, a.location, a.person, a.status,
           s.id AS selection_id, s.position, s.status AS selection_status, s.next_action, s.memo AS selection_memo,
           c.id AS company_id, c.name AS company, c.industry
    FROM appointment a
    JOIN selection s ON s.id = a.selection_id
    JOIN company c ON c.id = s.company_id
    WHERE a.at >= ? AND a.at < ? AND a.status = '予定'
      AND a.kind IN ('面接', '面談', '説明会', 'テスト')
    ORDER BY a.at
  `).all(range.from, range.until) as Row[]

  const notesFor = db.prepare('SELECT at, note, confidence FROM person_note WHERE person_id = ? ORDER BY at DESC LIMIT 5')
  const withNotes = (people: Row[]) => people.map((person) => ({ ...person, notes: notesFor.all(person.id as number) }))
  const linkedStmt = db.prepare(`
    SELECT p.id, p.name, p.role, p.category, p.met_at, p.how_met, ap.role AS appointment_role
    FROM appointment_person ap JOIN person p ON p.id = ap.person_id WHERE ap.appointment_id = ?
  `)
  const companyPeopleStmt = db.prepare(`
    SELECT p.id, p.name, p.role, p.category, p.met_at, p.how_met
    FROM person p WHERE p.company_id = ? ORDER BY p.updated_at DESC LIMIT 10
  `)
  const interviewsStmt = db.prepare(`
    SELECT occurred_at, title, summary FROM interview_note WHERE company_id = ? ORDER BY occurred_at DESC LIMIT 5
  `)
  const eventsStmt = db.prepare('SELECT at, kind, summary FROM event WHERE selection_id = ? ORDER BY at DESC LIMIT 8')

  const out = appointments.map((appointment) => ({
    ...appointment,
    linkedPeople: withNotes(linkedStmt.all(appointment.id as number) as Row[]),
    companyPeople: withNotes(companyPeopleStmt.all(appointment.company_id as number) as Row[]),
    pastInterviews: interviewsStmt.all(appointment.company_id as number),
    recentEvents: eventsStmt.all(appointment.selection_id as number),
  }))
  return { date, count: out.length, appointments: out }
}

const invokedDirectly = process.argv[1] != null && resolve(process.argv[1]).toLowerCase().endsWith('brief-data.ts')
if (invokedDirectly) {
  const config = loadConfig()
  const date = process.argv[2] ?? localDate(config.profile.timezone, 1)
  const db = openDb(resolveDatabasePath())
  try {
    console.log(JSON.stringify(getBriefData(db, date, utcOffsetFor(config.profile.timezone)), null, 1))
  } finally {
    db.close()
  }
}
