/**
 * 提出・結果をDBへ冪等反映する。status更新は必ず transition() を通す。
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DatabaseSync } from 'node:sqlite'
import { addEvent, openDb, outcomeOf, transition, type Stage } from '../src/db'
import { resolveSelectionId, transaction } from '../src/inputs'
import { resolveDatabasePath } from '../src/database-path'
import { completeMatchingRequirement } from '../src/submission-requirement'

interface SubmissionInput {
  sourceRef: string
  company: string
  position?: string
  kind: string
  submittedAt: string
  result?: string
  detail?: string
}

const dbArgIndex = process.argv.indexOf('--db')
const DB_PATH = resolveDatabasePath(dbArgIndex >= 0 ? process.argv[dbArgIndex + 1] : undefined)

function stageFor(result: string): Stage | null {
  if (/不合格|見送り/.test(result)) return 'rejected'
  if (/辞退/.test(result)) return 'closed'
  if (/内定/.test(result)) return 'offer'
  if (/合格|通過|参加確定/.test(result.replace(/不合格/g, ''))) return 'intern'
  return null
}

function validate(value: unknown): asserts value is SubmissionInput {
  if (!value || typeof value !== 'object') throw new Error('入力はオブジェクトです')
  const input = value as SubmissionInput
  for (const field of ['sourceRef', 'company', 'kind', 'submittedAt'] as const) {
    if (!String(input[field] || '').trim()) throw new Error(`${field} は必須です`)
  }
  if (Number.isNaN(Date.parse(input.submittedAt))) throw new Error('submittedAt が不正です')
}

export function applySubmission(input: SubmissionInput, db: DatabaseSync = openDb(DB_PATH)): { created: boolean; selectionId: number } {
  return transaction(db, () => {
    const duplicate = db.prepare('SELECT selection_id AS selectionId FROM submission WHERE source_ref = ?')
      .get(input.sourceRef) as { selectionId: number } | undefined
    if (duplicate) {
      completeMatchingRequirement(db, duplicate.selectionId, input.kind, input.sourceRef, new Date(input.submittedAt))
      return { created: false, selectionId: duplicate.selectionId }
    }
    const { selectionId } = resolveSelectionId(db, input.company, input.position)
    db.prepare(`
      INSERT INTO submission (selection_id, kind, submitted_at, result, detail, source_ref, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(selectionId, input.kind, input.submittedAt, input.result || '', input.detail || '', input.sourceRef, new Date().toISOString())
    db.prepare("UPDATE selection SET submitted = 1, updated_at = ?, updated_by = 'submit-agent' WHERE id = ?")
      .run(new Date().toISOString(), selectionId)
    const stage = stageFor(input.result || '')
    if (stage) {
      const row = db.prepare('SELECT status FROM selection WHERE id = ?').get(selectionId) as { status: string }
      const next = transition(row.status, stage)
      if (next) {
        db.prepare("UPDATE selection SET status = ?, outcome = ?, updated_at = ?, updated_by = 'submit-agent' WHERE id = ?")
          .run(next, outcomeOf(next), new Date().toISOString(), selectionId)
      }
    }
    addEvent(
      db, selectionId, input.result ? '提出結果' : '提出',
      input.result ? `${input.kind}: ${input.result}` : `${input.kind}を提出`,
      'submit-agent', input.submittedAt, input.sourceRef,
    )
    completeMatchingRequirement(db, selectionId, input.kind, input.sourceRef, new Date(input.submittedAt))
    return { created: true, selectionId }
  })
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && currentFile === resolve(process.argv[1])) {
  const file = process.argv[2]
  if (!file) throw new Error('使い方: npx tsx scripts/db-apply-submission.ts <submission.json>')
  const input: unknown = JSON.parse(readFileSync(resolve(file), 'utf8'))
  const items = Array.isArray(input) ? input : [input]
  const results = items.map((item) => {
    validate(item)
    return applySubmission(item)
  })
  console.log(JSON.stringify(results, null, 2))
}
