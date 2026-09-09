/** カレンダーの未解決予定を、応募選考ではなくキャリア支援面談として保持する。 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb } from '../src/db'
import { ensureCareerSupportSchema, upsertCareerMeeting, type CareerMeetingInput } from '../src/career-support'
import { transaction } from '../src/inputs'
import { resolveDatabasePath } from '../src/database-path'

interface Candidate extends CareerMeetingInput { company?: string; needsPosition?: boolean }
interface Input { events: Candidate[] }

export function applyCareerCalendar(input: Input, db = openDb(resolveDatabasePath())) {
  if (!input || !Array.isArray(input.events)) throw new Error('入力は {events:[...]} 形式です')
  ensureCareerSupportSchema(db)
  return transaction(db, () => {
    const result = { created: 0, updated: 0, scheduled: 0, review: 0, cancelled: 0 }
    for (const event of input.events) {
      // 企業は確定済みでpositionだけ未解決の行は、既存selection側のレビュー対象。
      // 支援面談へ二重登録しない。
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

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && currentFile === resolve(process.argv[1])) {
  const file = process.argv[2]
  if (!file) throw new Error('使い方: npx tsx scripts/db-apply-career-calendar.ts <calendar-residue.json>')
  console.log(JSON.stringify(applyCareerCalendar(JSON.parse(readFileSync(resolve(file), 'utf8'))), null, 2))
}
