import type { DatabaseSync } from 'node:sqlite'
import type { DatabaseContext } from './schedule.js'
import type { ThirdPartyEmailAction } from './third-party-email.js'
import {
  beginWorkflowStep,
  completeWorkflowStep,
  decideWorkflowApproval,
  getWorkflowRun,
  workflowHash,
  type WorkflowContract,
} from './workflow-control.js'

export type MuseEmailResultState = 'sent' | 'not_sent' | 'unknown'

export interface MuseEmailConnectorResult {
  state: MuseEmailResultState
  actionHash: string
  approvalId: string
  accountEmail: string
  to: string[]
  subjectHash: string
  bodyHash: string
  threadId: string
  sourceMessageId: string
  sentMessageId: string
  reconciledMessageId: string
  sentAt: string
  evidenceRef: string
  errorCode: string
}

export interface StoredMuseEmailResult extends MuseEmailConnectorResult {
  runId: string
  resultHash: string
  createdAt: string
  updatedAt: string
}

function timestamp(now?: Date): string { return (now ?? new Date()).toISOString() }
function normalizedEmail(value: string): string { return value.trim().toLowerCase() }
function normalizedRecipients(values: string[]): string[] { return [...new Set(values.map(normalizedEmail))].sort() }

export function museEmailExpectedEvidence(action: ThirdPartyEmailAction): Omit<MuseEmailConnectorResult, 'state' | 'approvalId' | 'sentMessageId' | 'reconciledMessageId' | 'sentAt' | 'evidenceRef' | 'errorCode'> {
  if (action.target.executor !== 'muse-email-connector') throw new Error('Muse email connector用actionではありません')
  if (action.actionType !== 'email.send') throw new Error('Muse email connectorはemail.sendだけを扱います')
  const accountEmail = normalizedEmail(action.target.senderEmail ?? '')
  if (!accountEmail) throw new Error('Muse email connectorの送信元がありません')
  return {
    actionHash: workflowHash(action), accountEmail, to: normalizedRecipients(action.target.to),
    subjectHash: workflowHash(action.content.subject), bodyHash: workflowHash(action.content.body),
    threadId: action.content.threadId, sourceMessageId: action.content.sourceMessageId,
  }
}

function validateResult(action: ThirdPartyEmailAction, result: MuseEmailConnectorResult, runCreatedAt: string, now?: Date): void {
  const expected = museEmailExpectedEvidence(action)
  if (result.actionHash !== expected.actionHash) throw new Error('Muse送信結果のaction hashが一致しません')
  if (normalizedEmail(result.accountEmail) !== expected.accountEmail) throw new Error('Muse送信結果の送信元が一致しません')
  if (JSON.stringify(normalizedRecipients(result.to)) !== JSON.stringify(expected.to)) throw new Error('Muse送信結果の宛先が一致しません')
  if (result.subjectHash !== expected.subjectHash || result.bodyHash !== expected.bodyHash) throw new Error('Muse送信結果の件名または本文hashが一致しません')
  if (result.threadId !== expected.threadId || result.sourceMessageId !== expected.sourceMessageId) throw new Error('Muse送信結果の元スレッドが一致しません')
  if (!result.evidenceRef.startsWith('muse-email:')) throw new Error('Muse送信結果のevidenceRefが不正です')
  if (result.state === 'unknown' && !result.approvalId) {
    throw new Error('送信成否不明にはMuse承認IDが必要です')
  }
  if (result.state === 'sent') {
    if (!result.approvalId || !result.sentMessageId || !result.reconciledMessageId || !result.sentAt) {
      throw new Error('送信済みにはMuse承認ID、送信ID、Sent再照合ID、送信時刻が必要です')
    }
    if (result.sentMessageId !== result.reconciledMessageId) throw new Error('送信IDとSent再照合IDが一致しません')
    if (!Number.isFinite(Date.parse(result.sentAt))) throw new Error('Muse送信時刻が不正です')
    const sentAt = Date.parse(result.sentAt)
    const earliest = Date.parse(runCreatedAt) - 5 * 60_000
    const latest = (now ?? new Date()).getTime() + 5 * 60_000
    if (sentAt < earliest || sentAt > latest) throw new Error('Muse送信時刻がworkflow実行範囲外です')
  }
}

export function ensureMuseEmailResultSchema(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS muse_email_result (
    run_id TEXT PRIMARY KEY REFERENCES workflow_run(run_id), action_hash TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('sent','not_sent','unknown')), result_hash TEXT NOT NULL,
    result_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );`)
}

export function getMuseEmailResult(db: DatabaseSync, runId: string): StoredMuseEmailResult | undefined {
  ensureMuseEmailResultSchema(db)
  const row = db.prepare(`SELECT action_hash AS actionHash,state,result_hash AS resultHash,
    result_json AS resultJson,created_at AS createdAt,updated_at AS updatedAt
    FROM muse_email_result WHERE run_id=?`).get(runId) as {
      actionHash: string; state: MuseEmailResultState; resultHash: string; resultJson: string; createdAt: string; updatedAt: string
    } | undefined
  if (!row) return undefined
  const result = JSON.parse(row.resultJson) as MuseEmailConnectorResult
  return { runId, ...result, resultHash: row.resultHash, createdAt: row.createdAt, updatedAt: row.updatedAt }
}

function saveResult(db: DatabaseSync, runId: string, result: MuseEmailConnectorResult, now?: Date): StoredMuseEmailResult {
  ensureMuseEmailResultSchema(db)
  const existing = getMuseEmailResult(db, runId)
  const resultHash = workflowHash(result)
  if (existing?.actionHash !== undefined && existing.actionHash !== result.actionHash) throw new Error('同じrunIdへ異なるMuse action結果を記録できません')
  if (existing?.state === 'sent' && existing.resultHash !== resultHash) throw new Error('送信済みのMuse action結果は変更できません')
  if (existing?.resultHash === resultHash) return existing
  const at = timestamp(now)
  if (existing) {
    db.prepare(`UPDATE muse_email_result SET state=?,result_hash=?,result_json=?,updated_at=? WHERE run_id=?`)
      .run(result.state, resultHash, JSON.stringify(result), at, runId)
  } else {
    db.prepare(`INSERT INTO muse_email_result
      (run_id,action_hash,state,result_hash,result_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
      .run(runId, result.actionHash, result.state, resultHash, JSON.stringify(result), at, at)
  }
  return getMuseEmailResult(db, runId)!
}

/** unknownは送信済みの可能性があるため完了・自動再送せず、Sent再照合まで固定する。 */
export function recordMuseEmailResult(
  db: DatabaseSync, contract: WorkflowContract, targetDatabase: DatabaseContext, runId: string,
  action: ThirdPartyEmailAction, result: MuseEmailConnectorResult, now?: Date,
): { workflow: ReturnType<typeof getWorkflowRun>; result: StoredMuseEmailResult; reconciliationRequired: boolean } {
  const before = getWorkflowRun(db, runId)
  validateResult(action, result, before.run.createdAt, now)
  if (!before.approval || before.approval.actionHash !== result.actionHash || workflowHash(before.approval.action) !== result.actionHash) {
    throw new Error('Muse送信結果を提示済みactionへ結び付けられません')
  }
  const stored = saveResult(db, runId, result, now)
  if (result.state !== 'sent') return { workflow: getWorkflowRun(db, runId), result: stored, reconciliationRequired: result.state === 'unknown' }

  let state = getWorkflowRun(db, runId)
  if (state.run.status === 'needs_user') {
    decideWorkflowApproval(db, contract, runId, 'approve', action, 'approved', targetDatabase, now)
    state = getWorkflowRun(db, runId)
  }
  if (state.run.status === 'running' && state.run.currentStepId === 'execute') {
    if (state.steps.find((step) => step.stepId === 'execute')?.status === 'pending') {
      beginWorkflowStep(db, contract, runId, 'execute', 'executor', {
        input: result, capabilities: ['external.commit.confirmed'], action, targetDatabase, now,
      })
      state = getWorkflowRun(db, runId)
    }
    if (state.steps.find((step) => step.stepId === 'execute')?.status === 'running') {
      completeWorkflowStep(db, contract, runId, 'execute', 'executor', { output: result, outputRef: result.evidenceRef, action, targetDatabase, now })
      state = getWorkflowRun(db, runId)
    }
  }
  if (state.run.status === 'running' && state.run.currentStepId === 'audit') {
    if (state.steps.find((step) => step.stepId === 'audit')?.status === 'pending') {
      beginWorkflowStep(db, contract, runId, 'audit', 'executor', { input: result, targetDatabase, now })
      state = getWorkflowRun(db, runId)
    }
    if (state.steps.find((step) => step.stepId === 'audit')?.status === 'running') {
      completeWorkflowStep(db, contract, runId, 'audit', 'executor', { output: result, outputRef: result.evidenceRef, targetDatabase, now })
    }
  }
  return { workflow: getWorkflowRun(db, runId), result: getMuseEmailResult(db, runId)!, reconciliationRequired: false }
}
