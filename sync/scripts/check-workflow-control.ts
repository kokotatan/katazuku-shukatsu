import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DatabaseContext } from '../src/db'
import { openDb } from '../src/db'
import { validateJsonSchema } from '../src/agent-runtime'
import {
  buildWorkspaceSendCall,
  hasScheduleCommitmentLanguage,
  preflightThirdPartyEmail,
  professionalEmailIssues,
  type ThirdPartyEmailAction,
} from '../src/third-party-email'
import {
  beginWorkflowStep,
  completeWorkflowStep,
  decideWorkflowApproval,
  failWorkflowStep,
  getWorkflowRun,
  loadWorkflowContract,
  openWorkflowStore,
  requestWorkflowApproval,
  startWorkflowRun,
  validateWorkflowContract,
  type WorkflowContract,
} from '../src/workflow-control'

let failed = 0
function check(label: string, condition: boolean, detail = ''): void {
  console.log(`${condition ? '[OK]' : '[NG]'} ${label}${condition ? '' : ` - ${detail}`}`)
  if (!condition) failed += 1
}
function expectThrow(label: string, fn: () => unknown, pattern: RegExp): void {
  try {
    fn()
    check(label, false, '例外が発生しませんでした')
  } catch (error) {
    const message = (error as Error).message
    check(label, pattern.test(message), message)
  }
}

const here = dirname(fileURLToPath(import.meta.url))
const dailyContractPath = join(here, '..', 'workflows', 'daily-sync.json')
const dailyContract = loadWorkflowContract(dailyContractPath)
const emailContractPath = join(here, '..', 'workflows', 'third-party-email.json')
const emailContract = loadWorkflowContract(emailContractPath)
const contractSchema = JSON.parse(readFileSync(join(here, '..', 'schemas', 'workflow-contract.schema.json'), 'utf8'))
const dailyRaw = JSON.parse(readFileSync(dailyContractPath, 'utf8'))
const proposalSchemaPath = join(here, '..', 'schemas', 'workflow-proposal.schema.json')
const thirdPartyActionSchemaPath = join(here, '..', 'schemas', 'third-party-action.schema.json')
check('daily-sync契約は共通JSON Schemaに一致する', validateJsonSchema(dailyRaw, contractSchema).length === 0,
  validateJsonSchema(dailyRaw, contractSchema).join(', '))
check('daily-syncのAgent工程はextractだけ',
  dailyContract.steps.filter((step) => step.owner === 'agent').map((step) => step.id).join(',') === 'extract')
check('daily-syncのAgent工程は副作用なし・gmail.readだけ', (() => {
  const step = dailyContract.steps.find((item) => item.id === 'extract')!
  return step.sideEffect === 'none' && step.capabilities.join(',') === 'gmail.read'
})())
check('third-party-email契約は共通JSON Schemaに一致する', (() => {
  const raw = JSON.parse(readFileSync(emailContractPath, 'utf8'))
  return validateJsonSchema(raw, contractSchema).length === 0
})())
check('third-party-emailは本人承認後のExecutorだけが送信する', (() => {
  const send = emailContract.steps.find((step) => step.id === 'send')
  const approve = emailContract.steps.find((step) => step.id === 'approve')
  return send?.owner === 'executor' && send.sideEffect === 'third-party-commit' &&
    send.requiresApprovalFrom === 'approve' && send.capabilities.includes('gmail.send.confirmed') &&
    approve?.owner === 'user' && approve.approval === 'user'
})())

const target: DatabaseContext = {
  databaseId: 'canonical-test-db',
  path: 'C:\\fixture\\katazuku.db',
  role: 'canonical',
  schemaVersion: 2,
}
const otherTarget: DatabaseContext = { ...target, databaseId: 'other-db' }
const otherPathTarget: DatabaseContext = { ...target, path: 'C:\\fixture\\other-katazuku.db' }

const simple: WorkflowContract = {
  schemaVersion: 1,
  id: 'simple',
  version: 1,
  title: '単純なworkflow',
  database: { requiredRole: 'canonical' },
  firstStep: 'think',
  steps: [
    {
      id: 'think', title: '提案', owner: 'agent', sideEffect: 'none', capabilities: ['gmail.read'],
      outputSchema: proposalSchemaPath, approval: 'none', idempotency: 'run-step', next: 'apply',
    },
    {
      id: 'apply', title: '反映', owner: 'executor', sideEffect: 'db-write', capabilities: [],
      approval: 'none', idempotency: 'external-key', next: null,
    },
  ],
}

expectThrow('AgentにDB書込を持たせた契約は拒否する', () => validateWorkflowContract({
  ...simple,
  steps: simple.steps.map((step) => step.id === 'think' ? { ...step, sideEffect: 'db-write' } : step),
} as WorkflowContract), /Agent stepは副作用/)
expectThrow('第三者確定操作に承認stepがない契約は拒否する', () => validateWorkflowContract({
  ...simple,
  steps: simple.steps.map((step) => step.id === 'apply'
    ? { ...step, sideEffect: 'third-party-commit' } : step),
} as WorkflowContract), /承認stepが必要/)
expectThrow('契約の未知フィールドは読み飛ばさず拒否する', () => validateWorkflowContract({
  ...simple,
  typoCapabilities: ['gmail.send.self'],
} as WorkflowContract), /未知のworkflow項目/)
expectThrow('canonical専用workflowはfixture DBで開始できない', () => {
  const db = openWorkflowStore(':memory:')
  try { startWorkflowRun(db, simple, {}, { ...target, role: 'fixture' }, 'fixture-run') } finally { db.close() }
}, /canonical DB専用/)

const store = openWorkflowStore(':memory:')
startWorkflowRun(store, simple, { source: 'mail' }, target, 'simple:1', new Date('2026-08-24T00:00:00Z'))
check('開始時に対象DB identityと最初のstepを固定する', (() => {
  const run = getWorkflowRun(store, 'simple:1').run
  return run.targetDatabaseId === target.databaseId && run.currentStepId === 'think' && run.status === 'running'
})())
check('同じrunId・同じ入力のstartは冪等',
  startWorkflowRun(store, simple, { source: 'mail' }, target, 'simple:1').currentStepId === 'think')
expectThrow('同じrunIdへ異なる入力を混ぜない',
  () => startWorkflowRun(store, simple, { source: 'calendar' }, target, 'simple:1'), /異なる入力/)
expectThrow('工程順を飛ばせない',
  () => beginWorkflowStep(store, simple, 'simple:1', 'apply', 'executor', { targetDatabase: target }), /現在のstepはthink/)
expectThrow('Agent工程をExecutorとして開始できない',
  () => beginWorkflowStep(store, simple, 'simple:1', 'think', 'executor', { targetDatabase: target }), /ownerはagent/)
expectThrow('Agent工程はcapabilityの明示なしで開始できない',
  () => beginWorkflowStep(store, simple, 'simple:1', 'think', 'agent', { targetDatabase: target }), /capabilities指定/)
expectThrow('契約外capabilityを追加できない',
  () => beginWorkflowStep(store, simple, 'simple:1', 'think', 'agent', {
    targetDatabase: target, capabilities: ['gmail.read', 'gmail.draft'],
  }), /契約外のcapability/)
expectThrow('開始後に別DBへ差し替えられない',
  () => beginWorkflowStep(store, simple, 'simple:1', 'think', 'agent', {
    targetDatabase: otherTarget, capabilities: ['gmail.read'],
  }), /異なるDB identity/)
expectThrow('同じidentityでも別パスのDBへ差し替えられない',
  () => beginWorkflowStep(store, simple, 'simple:1', 'think', 'agent', {
    targetDatabase: otherPathTarget, capabilities: ['gmail.read'],
  }), /identity\/role\/path/)

beginWorkflowStep(store, simple, 'simple:1', 'think', 'agent', {
  targetDatabase: target, capabilities: ['gmail.read'], input: { query: 'newer_than:1d' },
})
completeWorkflowStep(store, simple, 'simple:1', 'think', 'agent', {
  targetDatabase: target, output: { proposals: [] }, outputRef: 'logs/result.local.json',
})
check('Agent完了後はExecutor工程だけがcurrentになる', getWorkflowRun(store, 'simple:1').run.currentStepId === 'apply')
beginWorkflowStep(store, simple, 'simple:1', 'apply', 'executor', { targetDatabase: target })
completeWorkflowStep(store, simple, 'simple:1', 'apply', 'executor', { targetDatabase: target })
check('終端step完了でrunがdoneになる', getWorkflowRun(store, 'simple:1').run.status === 'done')

const changed = { ...simple, version: 2 }
expectThrow('開始後に契約versionを差し替えて再開できない',
  () => startWorkflowRun(store, changed, { source: 'mail' }, target, 'simple:1'), /契約が変更/)

const approvalContract: WorkflowContract = {
  schemaVersion: 1,
  id: 'send-mail',
  version: 1,
  title: '第三者メール送信',
  database: { requiredRole: 'canonical' },
  firstStep: 'draft',
  steps: [
    {
      id: 'draft', title: '下書き', owner: 'executor', sideEffect: 'external-draft', capabilities: [],
      approval: 'none', idempotency: 'external-key', next: 'approve',
    },
    {
      id: 'approve', title: '本人承認', owner: 'user', sideEffect: 'none', capabilities: [],
      inputSchema: thirdPartyActionSchemaPath, approval: 'user', idempotency: 'not-applicable', next: 'send',
    },
    {
      id: 'send', title: '送信', owner: 'executor', sideEffect: 'third-party-commit', capabilities: [],
      approval: 'none', requiresApprovalFrom: 'approve', idempotency: 'external-key', next: null,
    },
  ],
}
validateWorkflowContract(approvalContract)
const action = {
  actionType: 'email.send',
  target: { to: ['recruiter@example.com'], cc: [], bcc: [] },
  content: { subject: '面談日程について', body: '本文' },
  effectiveAt: 'immediate',
  notification: 'recruiter@example.comへメールが送信される',
}
startWorkflowRun(store, approvalContract, { mailId: 'm1' }, target, 'send:1')
beginWorkflowStep(store, approvalContract, 'send:1', 'draft', 'executor', { targetDatabase: target })
completeWorkflowStep(store, approvalContract, 'send:1', 'draft', 'executor', { targetDatabase: target })
expectThrow('承認提示は宛先・内容・実行時点・通知内容が揃わないと開始できない',
  () => requestWorkflowApproval(store, approvalContract, 'send:1', 'approve', {
    actionType: action.actionType, target: action.target, content: action.content, effectiveAt: action.effectiveAt,
  }, target), /inputがSchemaに一致/)
requestWorkflowApproval(store, approvalContract, 'send:1', 'approve', action, target)
check('承認提示でrunがneeds_userになる', getWorkflowRun(store, 'send:1').run.status === 'needs_user')
expectThrow('提示内容と違う本文を承認できない',
  () => decideWorkflowApproval(store, approvalContract, 'send:1', 'approve', {
    ...action, content: { ...action.content, body: '変更本文' },
  }, 'approved', target),
  /提示時と異なる/)
decideWorkflowApproval(store, approvalContract, 'send:1', 'approve', action, 'approved', target)
expectThrow('承認後に宛先を変えた確定操作は開始できない',
  () => beginWorkflowStep(store, approvalContract, 'send:1', 'send', 'executor', {
    targetDatabase: target, action: { ...action, target: { ...action.target, to: ['other@example.com'] } },
  }), /承認後に宛先/)
beginWorkflowStep(store, approvalContract, 'send:1', 'send', 'executor', { targetDatabase: target, action })
completeWorkflowStep(store, approvalContract, 'send:1', 'send', 'executor', { targetDatabase: target, action })
const approvalDone = getWorkflowRun(store, 'send:1')
check('承認と完全一致した確定操作だけdoneになる',
  approvalDone.run.status === 'done' && approvalDone.approval?.status === 'consumed')

startWorkflowRun(store, simple, {}, target, 'simple:unknown')
beginWorkflowStep(store, simple, 'simple:unknown', 'think', 'agent', {
  targetDatabase: target, capabilities: ['gmail.read'],
})
failWorkflowStep(store, simple, 'simple:unknown', 'think', 'agent', 'unknown', '同期範囲が不足')
check('根拠不足はfailedと混ぜずunknownで停止する', getWorkflowRun(store, 'simple:unknown').run.status === 'unknown')

store.close()

const emailTmp = mkdtempSync(join(tmpdir(), 'katazuku-email-workflow-'))
try {
  const db = openDb(join(emailTmp, 'katazuku.db'))
  try {
    const now = '2026-08-25T01:00:00.000Z'
    const companyResult = db.prepare(`INSERT INTO company (name, updated_at) VALUES (?, ?)`).run('GO株式会社', now)
    const companyId = Number(companyResult.lastInsertRowid)
    db.prepare(`INSERT INTO selection (company_id, position, status, updated_at) VALUES (?, ?, ?, ?)`)
      .run(companyId, '食事会', '参加予定', now)
    db.prepare(`INSERT INTO mail_item
      (id, company_id, received_at, sender, subject, source_ref, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run('mail-go-dinner', companyId, now, 'recruiter@example.com', '食事会のご案内', 'gmail:mail-go-dinner', now)

    const emailAction: ThirdPartyEmailAction = {
      actionType: 'gmail.send',
      target: {
        userGoogleEmail: 'okuyama.kotaro.career@gmail.com',
        to: ['recruiter@example.com'],
        companyName: 'GO株式会社',
      },
      content: {
        subject: 'Re: 食事会のご案内',
        body: 'GO株式会社\n新卒採用担当者様\n\nお世話になっております。東北大学大学院の奥山彪太郎です。\n\nご案内いただきありがとうございます。\nご確認のほど、よろしくお願いいたします。',
        threadId: 'thread-go-dinner',
        sourceMessageId: 'mail-go-dinner',
        scheduleCommitments: [],
      },
      effectiveAt: 'immediate',
      notification: 'GO株式会社の採用担当者へ食事会の返信が送信される',
    }
    const preflight = preflightThirdPartyEmail(db, emailAction)
    check('メール事前検査は正本DBの企業と元メールを照合する', preflight.ok, preflight.issues.join(' / '))
    const call = buildWorkspaceSendCall(emailAction)
    check('承認actionから送信tool callを決定論的に生成する',
      call.name === 'send_gmail_message' && call.arguments.thread_id === 'thread-go-dinner' &&
      call.arguments.to === 'recruiter@example.com')
    check('日時を約束しないメールへ不要なCalendar検査を要求しない', !hasScheduleCommitmentLanguage(emailAction))
    check('他社選考や訪中情報を文面検査で拒否する',
      professionalEmailIssues('他社の選考と訪中団からの帰国があるため変更希望です').length >= 2)
    const scheduleWithoutFacts: ThirdPartyEmailAction = {
      ...emailAction,
      content: { ...emailAction.content, body: '9月24日18時30分から参加を希望いたします。' },
    }
    const schedulePreflight = preflightThirdPartyEmail(db, scheduleWithoutFacts)
    check('日時を約束するのに予定情報がないactionを拒否する',
      !schedulePreflight.ok && schedulePreflight.issues.some((issue) => issue.includes('scheduleCommitments')))
  } finally {
    db.close()
  }
} finally {
  rmSync(emailTmp, { recursive: true, force: true })
}

console.log(`workflow-control テスト: ${failed === 0 ? '全件成功' : `${failed}件失敗`}`)
if (failed) process.exit(1)
