/** カレンダーの未解決予定を、応募選考ではなくキャリア支援面談として保持する。 */
import type { DatabaseSync } from 'node:sqlite'
import { ensureCareerSupportSchema, upsertCareerMeeting, type CareerMeetingInput } from './career-support.js'
import { transaction } from './inputs.js'

export interface CareerCalendarCandidate extends CareerMeetingInput {
  /** 企業は確定済みでpositionだけ未解決の行は、selection側で扱うためここでは無視する。 */
  company?: string
  needsPosition?: boolean
}

export interface CareerCalendarInput { events: CareerCalendarCandidate[] }

export interface CareerCalendarResult {
  created: number
  updated: number
  scheduled: number
  review: number
  cancelled: number
}

export function applyCareerCalendar(input: CareerCalendarInput, db: DatabaseSync): CareerCalendarResult {
  if (!input || !Array.isArray(input.events)) throw new Error('入力は {events:[...]} 形式です')
  ensureCareerSupportSchema(db)
  return transaction(db, () => {
    const result: CareerCalendarResult = { created: 0, updated: 0, scheduled: 0, review: 0, cancelled: 0 }
    for (const event of input.events) {
      if (event.company || event.needsPosition) continue
      const applied = upsertCareerMeeting(db, event)
      if (applied.created) result.created += 1
      else result.updated += 1
      if (applied.status === 'scheduled') result.scheduled += 1
      else if (applied.status === 'review') result.review += 1
      else if (applied.status === 'cancelled') result.cancelled += 1
    }
    return result
  })
}
