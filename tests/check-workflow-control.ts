import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DatabaseContext } from '../src/schedule.js'
import {
  beginWorkflowStep,
  completeWorkflowStep,
  decideWorkflowApproval,
  getWorkflowRun,
  loadWorkflowContract,
  openWorkflowStore,
  requestWorkflowApproval,
  startWorkflowRun,
  validateWorkflowContract,
  workflowHash,
  type WorkflowContract,
} from '../src/workflow-control.js'

const here = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = join(here, '..')
const contract = loadWorkflowContract(join(repositoryRoot, 'workflows', 'third-party-email.json'))
const externalContracts = [
  contract,
  loadWorkflowContract(join(repositoryRoot, 'workflows', 'third-party-form.json')),
  loadWorkflowContract(join(repositoryRoot, 'workflows', 'third-party-portal-message.json')),
]
const ingestionContracts = [
  loadWorkflowContract(join(repositoryRoot, 'workflows', 'daily-sync.json')),
  loadWorkflowContract(join(repositoryRoot, 'workflows', 'daily-sync-local.json')),
]
const target: DatabaseContext = {
  databaseId: 'fixture-canonical', path: '/fixture/katazuku.db', role: 'canonical', schemaVersion: 4,
}
const action = {
  actionType: 'gmail.send',
  target: { userGoogleEmail: 'user@example.com', to: ['recipient@example.com'], companyName: 'Example株式会社' },
  content: {
    subject: 'Re: 面談のご案内', body: 'Example株式会社\n採用担当者様\n\nお世話になっております。就活 太郎です。\n\nよろしくお願いいたします。\n\n就活 太郎\nTEL: （設定値）\nMail: user@example.com',
    threadId: 'thread-example', sourceMessageId: 'message-example', scheduleCommitments: [],
  },
  effectiveAt: 'immediate', notification: 'recipient@example.comへメールが送信される',
}

assert.equal(contract.steps.find((step) => step.id === 'send')?.requiresApprovalFrom, 'approve')
for (const externalContract of externalContracts) {
  const commit = externalContract.steps.find((step) => step.sideEffect === 'third-party-commit')
  assert(commit, `${externalContract.id}にthird-party-commit工程が必要です`)
  assert.equal(commit.requiresApprovalFrom, 'approve', `${externalContract.id}は本人承認を参照します`)
  assert.equal(commit.idempotency, 'external-key', `${externalContract.id}は外部冪等キーを要求します`)
  assert.equal(externalContract.database.requiredRole, 'canonical', `${externalContract.id}は正本DBだけで実行します`)
  assert(externalContract.steps.some((step) => step.id === 'audit' && step.next === null), `${externalContract.id}は監査工程で終端します`)
}
for (const ingestionContract of ingestionContracts) {
  assert.equal(ingestionContract.database.requiredRole, 'canonical')
  const extract = ingestionContract.steps.find((step) => step.id === 'extract')
  const apply = ingestionContract.steps.find((step) => step.id === 'apply')
  assert.equal(extract?.owner, 'agent')
  assert.equal(extract?.sideEffect, 'none')
  assert.equal(apply?.owner, 'executor')
  assert.equal(apply?.sideEffect, 'db-write')
  assert.equal(apply?.idempotency, 'external-key')
  assert(ingestionContract.steps.some((step) => step.id === 'validate' && step.sideEffect === 'none'))
}
const publicPortalSchema = readFileSync(join(repositoryRoot, 'schemas', 'third-party-portal-message-action.schema.json'), 'utf8')
assert(!publicPortalSchema.includes('snar.jp'), '公開schemaへprivate固有の採用ポータルhostを持ち出さない')
assert(!publicPortalSchema.includes('priorEmailMessageId'), 'ポータル連絡をメール固有のIDへ固定しない')
assert.throws(() => validateWorkflowContract({
  ...contract,
  steps: contract.steps.map((step) => step.id === 'validate' ? { ...step, owner: 'agent', sideEffect: 'db-write' } : step),
} as WorkflowContract), /Agent stepは副作用|副作用を持てるowner/)

const store = openWorkflowStore(':memory:')
try {
  startWorkflowRun(store, contract, { sourceRef: 'message-example' }, target, 'email:example')
  assert.throws(() => beginWorkflowStep(store, contract, 'email:example', 'send', 'executor', {
    targetDatabase: target, capabilities: ['mail.read', 'mail.send.confirmed'], action,
  }), /現在のstepはvalidate/)

  beginWorkflowStep(store, contract, 'email:example', 'validate', 'executor', { targetDatabase: target, input: action })
  completeWorkflowStep(store, contract, 'email:example', 'validate', 'executor', { targetDatabase: target })
  const requested = requestWorkflowApproval(store, contract, 'email:example', 'approve', action, target)
  assert.equal(requested.actionHash, workflowHash(action))
  assert.equal(getWorkflowRun(store, 'email:example').run.status, 'needs_user')

  assert.throws(() => decideWorkflowApproval(store, contract, 'email:example', 'approve', {
    ...action, content: { ...action.content, subject: '変更された件名' },
  }, 'approved', target), /提示時と異なる/)
  decideWorkflowApproval(store, contract, 'email:example', 'approve', action, 'approved', target)
  assert.throws(() => beginWorkflowStep(store, contract, 'email:example', 'send', 'executor', {
    targetDatabase: target,
    capabilities: ['mail.read', 'mail.send.confirmed'],
    action: { ...action, target: { ...action.target, to: ['other@example.com'] } },
  }), /承認後に宛先/)

  beginWorkflowStep(store, contract, 'email:example', 'send', 'executor', {
    targetDatabase: target, capabilities: ['mail.read', 'mail.send.confirmed'], action,
  })
  completeWorkflowStep(store, contract, 'email:example', 'send', 'executor', { targetDatabase: target, action })
  beginWorkflowStep(store, contract, 'email:example', 'audit', 'executor', { targetDatabase: target })
  completeWorkflowStep(store, contract, 'email:example', 'audit', 'executor', { targetDatabase: target })
  const finished = getWorkflowRun(store, 'email:example')
  assert.equal(finished.run.status, 'done')
  assert.equal(finished.approval?.status, 'consumed')

  assert.throws(() => startWorkflowRun(store, contract, { sourceRef: 'other' }, target, 'email:example'), /異なる入力/)
  assert.throws(() => startWorkflowRun(store, contract, { sourceRef: 'message-example' }, {
    ...target, databaseId: 'other-db',
  }, 'email:example'), /異なるDB/)
} finally {
  store.close()
}

console.log('workflow-control: 日次同期・メール・フォーム・採用ポータルの契約、正本固定、工程順、capability、本人承認hash、冪等化、監査を確認')
