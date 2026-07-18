/**
 * 面接議事録の厳格JSONを、面接・人物・人物メモ・プロフィール候補へ1トランザクションで反映する。
 * runId/sourceRef を一意キーにし、再実行しても重複しない。
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { addEvent, openDb } from '../src/db'
import { resolveSelectionId, transaction, upsertPerson } from '../src/inputs'

interface InterviewPerson {
  name: string
  company?: string
  role?: string
  category?: string
  notes?: string[]
  confidence?: number
}

interface ProfileSuggestion {
  field: string
  value: unknown
  confidence?: number
}

interface InterviewInput {
  runId: string
  appointmentId?: number
  company: string
  position?: string
  occurredAt: string
  title: string
  summary: string
  transcriptPath?: string
  questions?: { question: string; answer?: string; feedback?: string }[]
  people?: InterviewPerson[]
  profileSuggestions?: ProfileSuggestion[]
  followUps?: string[]
}

const dbArgIndex = process.argv.indexOf('--db')
const DB_PATH = dbArgIndex >= 0 ? resolve(process.argv[dbArgIndex + 1]) : (process.env.KATAZUKU_DB_PATH || join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'katazuku.db'))

function validate(input: unknown): asserts input is InterviewInput {
  if (!input || typeof input !== 'object') throw new Error('入力はオブジェクトです')
  const value = input as InterviewInput
  for (const field of ['runId', 'company', 'occurredAt', 'title', 'summary'] as const) {
    if (!String(value[field] || '').trim()) throw new Error(`${field} は必須です`)
  }
  if (Number.isNaN(Date.parse(value.occurredAt))) throw new Error('occurredAt が不正です')
  if (value.people && !Array.isArray(value.people)) throw new Error('people は配列です')
  if (value.profileSuggestions && !Array.isArray(value.profileSuggestions)) throw new Error('profileSuggestions は配列です')
}

export function applyInterview(input: InterviewInput): { created: boolean; interviewId: number } {
  const db = openDb(DB_PATH)
  return transaction(db, () => {
    const duplicate = db.prepare('SELECT id FROM interview_note WHERE source_ref = ?')
      .get(input.runId) as { id: number } | undefined
    if (duplicate) return { created: false, interviewId: duplicate.id }

    let selectionId: number
    let companyId: number
    if (input.appointmentId) {
      const appointment = db.prepare(`
        SELECT a.selection_id AS selectionId, s.company_id AS companyId
        FROM appointment a JOIN selection s ON s.id = a.selection_id WHERE a.id = ?
      `).get(input.appointmentId) as { selectionId: number; companyId: number } | undefined
      if (!appointment) throw new Error(`appointmentId が見つかりません: ${input.appointmentId}`)
      selectionId = appointment.selectionId
      companyId = appointment.companyId
    } else {
      const resolved = resolveSelectionId(db, input.company, input.position)
      selectionId = resolved.selectionId
      companyId = resolved.companyId
    }

    const detail = {
      questions: input.questions || [],
      followUps: input.followUps || [],
    }
    const inserted = db.prepare(`
      INSERT INTO interview_note
        (appointment_id, selection_id, company_id, occurred_at, title, summary,
         transcript_path, source_ref, data_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.appointmentId ?? null, selectionId, companyId, input.occurredAt,
      input.title, input.summary, input.transcriptPath || '', input.runId,
      JSON.stringify(detail), new Date().toISOString(),
    )
    const interviewId = Number(inserted.lastInsertRowid)

    for (const person of input.people || []) {
      const personId = upsertPerson(db, {
        name: person.name,
        companyId,
        company: person.company || input.company,
        role: person.role || '',
        category: person.category || '面接官',
        metAt: input.occurredAt,
        howMet: input.title,
      })
      if (input.appointmentId) {
        db.prepare('INSERT OR IGNORE INTO appointment_person (appointment_id, person_id, role) VALUES (?, ?, ?)')
          .run(input.appointmentId, personId, person.role || '')
      }
      for (const note of person.notes || []) {
        if (!note.trim()) continue
        db.prepare(`
          INSERT OR IGNORE INTO person_note (person_id, at, note, source_ref, confidence)
          VALUES (?, ?, ?, ?, ?)
        `).run(personId, input.occurredAt, note, input.runId, person.confidence ?? 0.8)
      }
    }

    for (const suggestion of input.profileSuggestions || []) {
      if (!suggestion.field.trim()) continue
      const value = typeof suggestion.value === 'string'
        ? suggestion.value
        : JSON.stringify(suggestion.value)
      db.prepare(`
        INSERT OR IGNORE INTO profile_suggestion
          (field, value, source_ref, confidence, status, created_at)
        VALUES (?, ?, ?, ?, '候補', ?)
      `).run(suggestion.field, value, input.runId, suggestion.confidence ?? 0.7, new Date().toISOString())
    }

    addEvent(db, selectionId, '面接記録', input.summary, 'interview-digest', input.occurredAt, input.runId)
    if (input.appointmentId) {
      db.prepare("UPDATE appointment SET status = '完了' WHERE id = ?").run(input.appointmentId)
      db.prepare(`
        UPDATE meeting_run SET state = 'done', ended_at = CASE WHEN ended_at = '' THEN ? ELSE ended_at END,
          digest_applied_at = ?, last_error = '', updated_at = ? WHERE appointment_id = ?
      `).run(input.occurredAt, new Date().toISOString(), new Date().toISOString(), input.appointmentId)
    }
    return { created: true, interviewId }
  })
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && currentFile === resolve(process.argv[1])) {
  const file = process.argv[2]
  if (!file) throw new Error('使い方: npx tsx scripts/db-apply-interview.ts <interview.json>')
  const input: unknown = JSON.parse(readFileSync(resolve(file), 'utf8'))
  validate(input)
  console.log(JSON.stringify(applyInterview(input), null, 2))
}
