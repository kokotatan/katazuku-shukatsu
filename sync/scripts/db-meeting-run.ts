/**
 * meeting_run 状態機械。予定IDごとに一回だけ実行し、ファイル状態を廃止する。
 * armed -> opened -> recording -> stopping -> digesting -> done
 */
import { randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb } from '../src/db'
import { transaction } from '../src/inputs'

const dbArgIndex = process.argv.indexOf('--db')
const DB_PATH = dbArgIndex >= 0 ? resolve(process.argv[dbArgIndex + 1]) : (process.env.KATAZUKU_DB_PATH || join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'katazuku.db'))
const ORDER = ['armed', 'opened', 'recording', 'stopping', 'digesting', 'done'] as const
type State = typeof ORDER[number] | 'failed'

function row(db: ReturnType<typeof openDb>, appointmentId: number): Record<string, unknown> {
  return db.prepare(`
    SELECT id, appointment_id AS appointmentId, state, opened_at AS openedAt,
      recording_started_at AS recordingStartedAt, ended_at AS endedAt,
      digest_applied_at AS digestAppliedAt, last_error AS lastError, updated_at AS updatedAt
    FROM meeting_run WHERE appointment_id = ?
  `).get(appointmentId) as Record<string, unknown>
}

export function ensureRun(appointmentId: number): Record<string, unknown> {
  const db = openDb(DB_PATH)
  const appointment = db.prepare('SELECT id FROM appointment WHERE id = ?').get(appointmentId)
  if (!appointment) throw new Error(`予定が見つかりません: ${appointmentId}`)
  db.prepare("INSERT OR IGNORE INTO meeting_run (id, appointment_id, state, updated_at) VALUES (?, ?, 'armed', ?)")
    .run(randomUUID(), appointmentId, new Date().toISOString())
  return row(db, appointmentId)
}

export function transitionRun(appointmentId: number, next: State, error = ''): Record<string, unknown> {
  const db = openDb(DB_PATH)
  return transaction(db, () => {
    db.prepare("INSERT OR IGNORE INTO meeting_run (id, appointment_id, state, updated_at) VALUES (?, ?, 'armed', ?)")
      .run(randomUUID(), appointmentId, new Date().toISOString())
    const current = row(db, appointmentId)
    const currentState = String(current.state) as State
    if (currentState === 'done') return current
    if (next !== 'failed') {
      const from = currentState === 'failed' ? -1 : ORDER.indexOf(currentState as typeof ORDER[number])
      const to = ORDER.indexOf(next as typeof ORDER[number])
      if (to < 0 || to < from || to > from + 1) {
        throw new Error(`不正な状態遷移: ${currentState} -> ${next}`)
      }
    }
    const now = new Date().toISOString()
    db.prepare(`
      UPDATE meeting_run SET state = ?,
        opened_at = CASE WHEN ? = 'opened' AND opened_at = '' THEN ? ELSE opened_at END,
        recording_started_at = CASE WHEN ? = 'recording' AND recording_started_at = '' THEN ? ELSE recording_started_at END,
        ended_at = CASE WHEN ? IN ('stopping','digesting','done') AND ended_at = '' THEN ? ELSE ended_at END,
        digest_applied_at = CASE WHEN ? = 'done' AND digest_applied_at = '' THEN ? ELSE digest_applied_at END,
        last_error = ?, updated_at = ?
      WHERE appointment_id = ?
    `).run(next, next, now, next, now, next, now, next, now, error, now, appointmentId)
    return row(db, appointmentId)
  })
}

const command = process.argv[2]
const appointmentId = Number(process.argv[3])
if (!command || !Number.isInteger(appointmentId)) throw new Error('使い方: npx tsx scripts/db-meeting-run.ts <ensure|transition> <appointmentId> [state] [error]')
if (command === 'ensure') console.log(JSON.stringify(ensureRun(appointmentId)))
else if (command === 'transition') {
  const error = process.argv[5] && process.argv[5] !== '--db' ? process.argv[5] : ''
  console.log(JSON.stringify(transitionRun(appointmentId, process.argv[4] as State, error)))
}
else throw new Error(`不明なcommand: ${command}`)
