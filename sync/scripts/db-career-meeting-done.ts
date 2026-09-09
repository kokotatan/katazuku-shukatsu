/** 支援面談を完了にする。selectionイベントは作らない。 */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb } from '../src/db'
import { ensureCareerSupportSchema } from '../src/career-support'
import { resolveDatabasePath } from '../src/database-path'

export function completeCareerMeeting(id: number) {
  const db = openDb(resolveDatabasePath())
  ensureCareerSupportSchema(db)
  const row = db.prepare('SELECT id, title, status FROM career_meeting WHERE id = ?').get(id) as { id: number; title: string; status: string } | undefined
  if (!row) throw new Error(`支援面談が見つかりません: ${id}`)
  if (row.status !== 'completed') db.prepare("UPDATE career_meeting SET status = 'completed', updated_at = ? WHERE id = ?").run(new Date().toISOString(), id)
  return { id, title: row.title, completed: true }
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && currentFile === resolve(process.argv[1])) {
  const id = Number(process.argv[2])
  if (!Number.isInteger(id) || id <= 0) throw new Error('使い方: db-career-meeting-done.ts <id>')
  console.log(JSON.stringify(completeCareerMeeting(id)))
}
