/**
 * 同じ会社の重複selectionを、関連イベント・予定・面接・提出ごと1トランザクションで統合する。
 * 実行には --execute が必要。keepIdを残し、mergeIdを削除する。
 */
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { addEvent, openDb, outcomeOf } from '../src/db'
import { transaction } from '../src/inputs'
import { resolveDatabasePath } from '../src/database-path'
import { moveMeetingPreparation } from '../src/meeting-preparation'

const dbArgIndex = process.argv.indexOf('--db')
const DB_PATH = resolveDatabasePath(dbArgIndex >= 0 ? process.argv[dbArgIndex + 1] : undefined)

interface Track {
  id: number
  company_id: number
  company: string
  position: string
  priority: string
  status: string
  step1: string
  step2: string
  step3: string
  step4: string
  next_action: string
  next_date: string
  submitted: number
  es_url: string
  memo: string
}

function track(db: ReturnType<typeof openDb>, id: number): Track {
  const value = db.prepare(`
    SELECT s.*, c.name AS company FROM selection s
    JOIN company c ON c.id = s.company_id WHERE s.id = ?
  `).get(id) as unknown as Track | undefined
  if (!value) throw new Error(`トラックが見つかりません: ${id}`)
  return value
}

function longer(a: string, b: string): string {
  return b.trim().length > a.trim().length ? b : a
}

function mergedStatus(a: string, b: string): string {
  const negative = /不合格|辞退|欠席|振替不可|見送り|実質終了/
  const aNeg = negative.test(a)
  const bNeg = negative.test(b)
  if (aNeg || bNeg) return aNeg && bNeg ? longer(a, b) : (bNeg ? b : a)
  if (/内定/.test(a) || /内定/.test(b)) return /内定/.test(b) ? b : a
  return longer(a, b)
}

function mergeAppointments(db: ReturnType<typeof openDb>, keepId: number, mergeId: number): void {
  const sourceAppointments = db.prepare('SELECT * FROM appointment WHERE selection_id = ?').all(mergeId) as Record<string, unknown>[]
  for (const source of sourceAppointments) {
    const duplicate = db.prepare('SELECT id FROM appointment WHERE selection_id = ? AND at = ? AND title = ?')
      .get(keepId, String(source.at), String(source.title)) as { id: number } | undefined
    const sourceId = Number(source.id)
    if (!duplicate) {
      db.prepare('UPDATE appointment SET selection_id = ? WHERE id = ?').run(keepId, sourceId)
      continue
    }
    const targetId = duplicate.id
    db.prepare('INSERT OR IGNORE INTO appointment_person (appointment_id, person_id, role) SELECT ?, person_id, role FROM appointment_person WHERE appointment_id = ?')
      .run(targetId, sourceId)
    const sourceRun = db.prepare('SELECT id FROM meeting_run WHERE appointment_id = ?').get(sourceId) as { id: string } | undefined
    const targetRun = db.prepare('SELECT id FROM meeting_run WHERE appointment_id = ?').get(targetId) as { id: string } | undefined
    if (sourceRun && !targetRun) db.prepare('UPDATE meeting_run SET appointment_id = ? WHERE appointment_id = ?').run(targetId, sourceId)
    else if (sourceRun && targetRun) db.prepare('DELETE FROM meeting_run WHERE appointment_id = ?').run(sourceId)
    db.prepare('UPDATE interview_note SET appointment_id = ? WHERE appointment_id = ?').run(targetId, sourceId)
    db.prepare('DELETE FROM appointment_person WHERE appointment_id = ?').run(sourceId)
    moveMeetingPreparation(db, sourceId, targetId)
    db.prepare('DELETE FROM appointment WHERE id = ?').run(sourceId)
  }
}

export function mergeTracks(keepId: number, mergeId: number, execute: boolean): Record<string, unknown> {
  if (keepId === mergeId) throw new Error('keepIdとmergeIdは別にしてください')
  const db = openDb(DB_PATH)
  const keep = track(db, keepId)
  const source = track(db, mergeId)
  if (keep.company_id !== source.company_id) {
    throw new Error(`別会社は統合できません: ${keep.company} / ${source.company}`)
  }
  const counts = {
    events: Number((db.prepare('SELECT COUNT(*) AS n FROM event WHERE selection_id = ?').get(mergeId) as { n: number }).n),
    appointments: Number((db.prepare('SELECT COUNT(*) AS n FROM appointment WHERE selection_id = ?').get(mergeId) as { n: number }).n),
    interviews: Number((db.prepare('SELECT COUNT(*) AS n FROM interview_note WHERE selection_id = ?').get(mergeId) as { n: number }).n),
    submissions: Number((db.prepare('SELECT COUNT(*) AS n FROM submission WHERE selection_id = ?').get(mergeId) as { n: number }).n),
    mails: Number((db.prepare('SELECT COUNT(*) AS n FROM mail_item WHERE selection_id = ?').get(mergeId) as { n: number }).n),
  }
  if (!execute) return { execute: false, keep, merge: source, related: counts }

  return transaction(db, () => {
    const status = mergedStatus(keep.status, source.status)
    const steps = Array.from(new Set([
      keep.step1, keep.step2, keep.step3, keep.step4,
      source.step1, source.step2, source.step3, source.step4,
    ].filter(Boolean))).slice(0, 4)
    const memo = keep.memo && source.memo && keep.memo !== source.memo
      ? `${keep.memo} / ${source.memo}`
      : (keep.memo || source.memo)
    db.prepare(`
      UPDATE selection SET position = ?, priority = ?, status = ?, outcome = ?,
        step1 = ?, step2 = ?, step3 = ?, step4 = ?,
        next_action = ?, next_date = ?, submitted = ?, es_url = ?, memo = ?,
        updated_at = ?, updated_by = 'db-merge-tracks'
      WHERE id = ?
    `).run(
      longer(keep.position, source.position),
      keep.priority || source.priority,
      status, outcomeOf(status),
      steps[0] || '', steps[1] || '', steps[2] || '', steps[3] || '',
      longer(keep.next_action, source.next_action),
      source.next_date || keep.next_date,
      keep.submitted || source.submitted ? 1 : 0,
      keep.es_url || source.es_url,
      memo,
      new Date().toISOString(),
      keepId,
    )
    mergeAppointments(db, keepId, mergeId)
    db.prepare('UPDATE event SET selection_id = ? WHERE selection_id = ?').run(keepId, mergeId)
    db.prepare('UPDATE interview_note SET selection_id = ? WHERE selection_id = ?').run(keepId, mergeId)
    db.prepare('UPDATE submission SET selection_id = ? WHERE selection_id = ?').run(keepId, mergeId)
    db.prepare('UPDATE mail_item SET selection_id = ? WHERE selection_id = ?').run(keepId, mergeId)
    db.prepare('DELETE FROM selection WHERE id = ?').run(mergeId)
    addEvent(db, keepId, 'トラック統合', `重複トラック #${mergeId} を #${keepId} へ統合`, 'db-merge-tracks', undefined, `merge:${keepId}:${mergeId}`)
    return { execute: true, keepId, removedId: mergeId, company: keep.company, related: counts }
  })
}

const keepId = Number(process.argv[2])
const mergeId = Number(process.argv[3])
if (!Number.isInteger(keepId) || !Number.isInteger(mergeId)) {
  throw new Error('使い方: npx tsx scripts/db-merge-tracks.ts <keepId> <mergeId> [--execute] [--db path]')
}
console.log(JSON.stringify(mergeTracks(keepId, mergeId, process.argv.includes('--execute')), null, 2))
