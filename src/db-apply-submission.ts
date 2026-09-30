/**
 * 提出・結果をDBへ冪等反映する(source_ref が冪等キー)。status 更新は必ず transition() を通す。
 * 提出根拠が入ったら、同じ選考・種別で一意に特定できる未完了の提出物台帳だけを閉じる。
 */
import type { DatabaseSync } from 'node:sqlite'
import { addEvent, outcomeOf, transition, type Stage } from './db.js'
import { resolveSelectionId, transaction } from './inputs.js'
import { completeMatchingRequirement } from './submission-requirement.js'

export interface SubmissionInput {
  sourceRef: string
  company: string
  position?: string
  kind: string
  submittedAt: string
  result?: string
  detail?: string
}

function stageFor(result: string): Stage | null {
  if (/不合格|見送り/.test(result)) return 'rejected'
  if (/辞退/.test(result)) return 'closed'
  if (/内定/.test(result)) return 'offer'
  if (/合格|通過|参加確定/.test(result.replace(/不合格/g, ''))) return 'intern'
  return null
}

export function validateSubmission(value: unknown): asserts value is SubmissionInput {
  if (!value || typeof value !== 'object') throw new Error('入力はオブジェクトです')
  const input = value as SubmissionInput
  for (const field of ['sourceRef', 'company', 'kind', 'submittedAt'] as const) {
    if (!String(input[field] || '').trim()) throw new Error(`${field} は必須です`)
  }
  if (Number.isNaN(Date.parse(input.submittedAt))) throw new Error('submittedAt が不正です')
}

export function applySubmission(db: DatabaseSync, input: SubmissionInput): { created: boolean; selectionId: number } {
  validateSubmission(input)
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
