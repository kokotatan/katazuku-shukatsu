import assert from 'node:assert/strict'
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
const contract = loadWorkflowContract(join(here, '..', 'workflows', 'third-party-email.json'))
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
assert.throws(() => validateWorkflowContract({
  ...contract,
  steps: contract.steps.map((step) => step.id === 'validate' ? { ...step, owner: 'agent', sideEffect: 'db-write' } : step),
} as WorkflowContract), /Agent stepは副作用|副作用を持てるowner/)

const store = openWorkflowStore(':memory:')
try {
  startWorkflowRun(store, contract, { sourceRef: 'message-example' }, target, 'email:example')
  assert.throws(() => beginWorkflowStep(store, contract, 'email:example', 'send', 'executor', {
    targetDatabase: target, capabilities: ['gmail.read', 'gmail.send.confirmed'], action,
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
    capabilities: ['gmail.read', 'gmail.send.confirmed'],
    action: { ...action, target: { ...action.target, to: ['other@example.com'] } },
  }), /承認後に宛先/)

  beginWorkflowStep(store, contract, 'email:example', 'send', 'executor', {
    targetDatabase: target, capabilities: ['gmail.read', 'gmail.send.confirmed'], action,
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

console.log('workflow-control: 契約・正本固定・工程順・capability・本人承認hash・消費を確認')
