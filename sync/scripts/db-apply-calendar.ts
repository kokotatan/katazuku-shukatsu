/**
 * カレンダーイベントを appointment へ冪等upsertする。
 * 入力: {events:[{externalId,title,startAt,endAt,company,position?,...}]}
 */
import { readFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { addEvent, openDb } from '../src/db'
import { resolveSelectionId, transaction, upsertPerson } from '../src/inputs'

interface CalendarEvent {
  externalId: string
  calendarId?: string
  title: string
  startAt: string
  endAt?: string
  company: string
  position?: string
  kind?: string
  url?: string
  location?: string
  status?: string
  attendees?: { name: string; role?: string }[]
  sourceHash?: string
}

interface CalendarInput { events: CalendarEvent[] }

const dbArgIndex = process.argv.indexOf('--db')
const DB_PATH = dbArgIndex >= 0 ? resolve(process.argv[dbArgIndex + 1]) : (process.env.KATAZUKU_DB_PATH || join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'katazuku.db'))

function assertInput(value: unknown): asserts value is CalendarInput {
  if (!value || typeof value !== 'object' || !Array.isArray((value as CalendarInput).events)) {
    throw new Error('入力は {events:[...]} 形式です')
  }
  for (const [index, event] of (value as CalendarInput).events.entries()) {
    if (!event.externalId || !event.title || !event.startAt || !event.company) {
      throw new Error(`events[${index}] は externalId/title/startAt/company が必須です`)
    }
    if (Number.isNaN(Date.parse(event.startAt))) throw new Error(`events[${index}].startAt が不正です`)
    if (event.endAt && Number.isNaN(Date.parse(event.endAt))) throw new Error(`events[${index}].endAt が不正です`)
  }
}

export function applyCalendar(input: CalendarInput): { created: number; updated: number; unchanged: number } {
  const db = openDb(DB_PATH)
  return transaction(db, () => {
    const result = { created: 0, updated: 0, unchanged: 0 }
    for (const event of input.events) {
      const { selectionId, companyId } = resolveSelectionId(db, event.company, event.position)
      const sourceHash = event.sourceHash || createHash('sha256').update(JSON.stringify({
        title: event.title, startAt: event.startAt, endAt: event.endAt || '',
        url: event.url || '', location: event.location || '', status: event.status || '予定',
      })).digest('hex')
      const prior = db.prepare('SELECT id, source_hash FROM appointment WHERE external_id = ?')
        .get(event.externalId) as { id: number; source_hash: string } | undefined
      let appointmentId: number
      if (prior) {
        appointmentId = prior.id
        if (prior.source_hash === sourceHash) {
          result.unchanged += 1
        } else {
          db.prepare(`
            UPDATE appointment SET selection_id = ?, at = ?, end_at = ?, kind = ?, title = ?,
              url = ?, location = ?, person = ?, status = ?, calendar_id = ?, source_hash = ?
            WHERE id = ?
          `).run(
            selectionId, event.startAt, event.endAt || '', event.kind || 'その他', event.title,
            event.url || '', event.location || '',
            (event.attendees || []).map((a) => a.name).join('、'),
            event.status === 'cancelled' || event.status === '中止' ? '中止' : '予定',
            event.calendarId || '', sourceHash, appointmentId,
          )
          addEvent(db, selectionId, '予定更新', `カレンダー更新: ${event.title}`, 'calendar-sync', event.startAt, event.externalId)
          result.updated += 1
        }
      } else {
        const inserted = db.prepare(`
          INSERT INTO appointment
            (selection_id, at, end_at, kind, title, url, location, person, status, created_at,
             external_id, calendar_id, source_hash)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          selectionId, event.startAt, event.endAt || '', event.kind || 'その他', event.title,
          event.url || '', event.location || '',
          (event.attendees || []).map((a) => a.name).join('、'),
          event.status === 'cancelled' || event.status === '中止' ? '中止' : '予定',
          new Date().toISOString(), event.externalId, event.calendarId || '', sourceHash,
        )
        appointmentId = Number(inserted.lastInsertRowid)
        addEvent(db, selectionId, '予定追加', `カレンダー追加: ${event.title}`, 'calendar-sync', event.startAt, event.externalId)
        result.created += 1
      }
      for (const attendee of event.attendees || []) {
        if (!attendee.name.trim()) continue
        const personId = upsertPerson(db, {
          name: attendee.name,
          companyId,
          company: event.company,
          role: attendee.role || '',
          metAt: event.startAt,
          howMet: event.kind || 'カレンダー予定',
        })
        db.prepare('INSERT OR IGNORE INTO appointment_person (appointment_id, person_id, role) VALUES (?, ?, ?)')
          .run(appointmentId, personId, attendee.role || '')
      }
      if (/面接|面談/.test(event.kind || event.title)) {
        db.prepare(`
          INSERT OR IGNORE INTO meeting_run (id, appointment_id, state, updated_at)
          VALUES (?, ?, 'armed', ?)
        `).run(randomUUID(), appointmentId, new Date().toISOString())
      }
    }
    return result
  })
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && currentFile === resolve(process.argv[1])) {
  const file = process.argv[2]
  if (!file) throw new Error('使い方: npx tsx scripts/db-apply-calendar.ts <calendar.json>')
  const input: unknown = JSON.parse(readFileSync(resolve(file), 'utf8'))
  assertInput(input)
  console.log(JSON.stringify(applyCalendar(input), null, 2))
}
