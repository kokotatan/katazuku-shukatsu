/** 支援面談用の会議状態機械。応募先appointmentのmeeting_runとは分離する。 */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb } from '../src/db'
import { ensureCareerSupportSchema } from '../src/career-support'
import { transaction } from '../src/inputs'
import { resolveDatabasePath } from '../src/database-path'

const DB_PATH = resolveDatabasePath()
const ORDER = ['armed', 'opened', 'recording', 'stopping', 'digesting', 'done'] as const
type State = typeof ORDER[number] | 'failed'

function row(db: ReturnType<typeof openDb>, meetingId: number): Record<string, unknown> {
  return db.prepare(`SELECT id, career_meeting_id AS careerMeetingId, state,
    opened_at AS openedAt, recording_started_at AS recordingStartedAt, ended_at AS endedAt,
    digest_applied_at AS digestAppliedAt, last_error AS lastError, updated_at AS updatedAt
    FROM career_meeting_run WHERE career_meeting_id = ?`).get(meetingId) as Record<string, unknown>
}

export function ensureRun(meetingId: number) {
  const db = openDb(DB_PATH)
  ensureCareerSupportSchema(db)
  if (!db.prepare("SELECT id FROM career_meeting WHERE id = ? AND status = 'scheduled'").get(meetingId)) {
    throw new Error(`予定状態の支援面談が見つかりません: ${meetingId}`)
  }
  db.prepare("INSERT OR IGNORE INTO career_meeting_run (id, career_meeting_id, state, updated_at) VALUES (lower(hex(randomblob(16))), ?, 'armed', ?)")
    .run(meetingId, new Date().toISOString())
  return row(db, meetingId)
}

export function transitionRun(meetingId: number, next: State, error = '') {
  const db = openDb(DB_PATH)
  ensureCareerSupportSchema(db)
  return transaction(db, () => {
    if (!db.prepare("SELECT id FROM career_meeting WHERE id = ? AND status = 'scheduled'").get(meetingId)) {
      throw new Error(`予定状態の支援面談が見つかりません: ${meetingId}`)
    }
    db.prepare("INSERT OR IGNORE INTO career_meeting_run (id, career_meeting_id, state, updated_at) VALUES (lower(hex(randomblob(16))), ?, 'armed', ?)")
      .run(meetingId, new Date().toISOString())
    const current = row(db, meetingId)
    const currentState = String(current.state) as State
    if (currentState === 'done') return current
    if (next !== 'failed') {
      const from = currentState === 'failed' ? -1 : ORDER.indexOf(currentState as typeof ORDER[number])
      const to = ORDER.indexOf(next as typeof ORDER[number])
      if (to < 0 || to < from || to > from + 1) throw new Error(`不正な状態遷移: ${currentState} -> ${next}`)
    }
    const now = new Date().toISOString()
    db.prepare(`UPDATE career_meeting_run SET state = ?,
      opened_at = CASE WHEN ? = 'opened' AND opened_at = '' THEN ? ELSE opened_at END,
      recording_started_at = CASE WHEN ? = 'recording' AND recording_started_at = '' THEN ? ELSE recording_started_at END,
      ended_at = CASE WHEN ? IN ('stopping','digesting','done') AND ended_at = '' THEN ? ELSE ended_at END,
      digest_applied_at = CASE WHEN ? = 'done' AND digest_applied_at = '' THEN ? ELSE digest_applied_at END,
      last_error = ?, updated_at = ? WHERE career_meeting_id = ?`)
      .run(next, next, now, next, now, next, now, next, now, error, now, meetingId)
    return row(db, meetingId)
  })
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && currentFile === resolve(process.argv[1])) {
  const command = process.argv[2]
  const id = Number(process.argv[3])
  if (!command || !Number.isInteger(id) || id <= 0) throw new Error('使い方: db-career-meeting-run.ts <ensure|transition> <id> [state] [error]')
  if (command === 'ensure') console.log(JSON.stringify(ensureRun(id)))
  else if (command === 'transition') console.log(JSON.stringify(transitionRun(id, process.argv[4] as State, process.argv[5] || '')))
  else throw new Error(`不明なcommand: ${command}`)
}
