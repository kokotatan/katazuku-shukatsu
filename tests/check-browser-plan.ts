/** ブラウザ操作計画が自由実行・秘密値・二重確定を許さないことを合成Driverで確認する。 */
import assert from 'node:assert/strict'
import {
  runBrowserPlan,
  summarizeBrowserPlan,
  validateBrowserPlan,
  type BrowserDriver,
  type BrowserOperationPlan,
  type BrowserPlanStep,
} from '../src/browser-plan.js'
import { workflowHash } from '../src/workflow-control.js'

let checks = 0
function check(label: string, condition: boolean): void {
  assert(condition, label)
  checks++
  console.log('[ok] ' + label)
}
async function rejects(label: string, operation: () => unknown | Promise<unknown>, pattern: RegExp): Promise<void> {
  await assert.rejects(async () => await operation(), pattern)
  checks++
  console.log('[ok] ' + label)
}

const syntheticEmail = ['applicant', 'example.test'].join('@')
const action = {
  target: { email: syntheticEmail },
  content: { motivation: '合成応募の動機', consent: true },
}
const plan: BrowserOperationPlan = {
  schemaVersion: 1,
  id: 'synthetic-application',
  effect: 'third-party-commit',
  target: { origin: 'https://jobs.example.test', pathPrefix: '/apply' },
  database: { id: 'canonical-fixture', role: 'canonical' },
  actionHash: workflowHash(action),
  externalIdempotencyKey: 'application:fixture:0001',
  steps: [
    { type: 'navigate', url: 'https://jobs.example.test/apply/new' },
    { type: 'assert', selector: '#application-form', condition: 'visible' },
    { type: 'fill', selector: '#email', valueRef: '/target/email' },
    { type: 'fill', selector: '#motivation', valueRef: '/content/motivation' },
    { type: 'click', selector: '#confirm' },
    { type: 'assert', selector: '#review-email', condition: 'text-equals-approved', valueRef: '/target/email' },
    { type: 'commit', selector: '#submit', action: 'submit' },
  ],
}

const copy = <T>(value: T): T => structuredClone(value)
const driverCalls: Array<{ type: string; value?: unknown; key: string }> = []
const driver: BrowserDriver = {
  async run(step, context) {
    driverCalls.push({ type: step.type, value: context.approvedValue, key: context.externalIdempotencyKey })
    return { state: 'ok' }
  },
}

validateBrowserPlan(plan)
check('安全な合成planを受理する', true)
const firstSummary = summarizeBrowserPlan(plan)
const secondSummary = summarizeBrowserPlan(copy(plan))
check('plan hashとsummaryが決定論的である', JSON.stringify(firstSummary) === JSON.stringify(secondSummary))
check('summaryは生selectorと承認値を含まない', !JSON.stringify(firstSummary).includes('#email')
  && !JSON.stringify(firstSummary).includes(syntheticEmail)
  && firstSummary.steps.some((step) => step.selectorHash?.length === 16))

const dryRun = await runBrowserPlan({ plan, mode: 'dry-run', driver })
check('dry-runはsummaryだけを返す', dryRun.status === 'dry_run' && dryRun.summary.planHash === firstSummary.planHash)
check('dry-runはDriverを一度も呼ばない', driverCalls.length === 0)

for (const [label, url] of [
  ['HTTP', 'http://jobs.example.test/apply/new'],
  ['userinfo', `https://${['user', 'jobs.example.test'].join('@')}/apply/new`],
  ['query', 'https://jobs.example.test/apply/new?token=x'],
  ['fragment', 'https://jobs.example.test/apply/new#confirm'],
  ['別path', 'https://jobs.example.test/admin'],
  ['別origin', 'https://evil.example.test/apply/new'],
] as const) {
  const invalid = copy(plan)
  ;(invalid.steps[0] as { type: 'navigate'; url: string }).url = url
  await rejects(`${label}への遷移を拒否する`, () => validateBrowserPlan(invalid), /許可origin/)
}

const evaluate = copy(plan) as BrowserOperationPlan & { steps: Array<BrowserPlanStep | { type: 'evaluate'; script: string }> }
evaluate.steps.splice(1, 0, { type: 'evaluate', script: 'document.cookie' })
await rejects('任意JavaScript操作を拒否する', () => validateBrowserPlan(evaluate as BrowserOperationPlan), /未知の操作/)

const literal = copy(plan) as BrowserOperationPlan & { steps: Array<BrowserPlanStep & { value?: string }> }
literal.steps[2] = { ...(literal.steps[2] as BrowserPlanStep), value: 'raw-value' }
await rejects('計画内の生値を拒否する', () => validateBrowserPlan(literal as BrowserOperationPlan), /未知の項目/)

for (const sensitive of ['/credentials/password', '/sessionToken', '/content/api_key']) {
  const invalid = copy(plan)
  ;(invalid.steps[2] as { type: 'fill'; valueRef: string }).valueRef = sensitive
  await rejects(`秘密値参照 ${sensitive} を拒否する`, () => validateBrowserPlan(invalid), /非機密JSON Pointer/)
}
const passwordSelector = copy(plan)
;(passwordSelector.steps[2] as { type: 'fill'; selector: string }).selector = 'input[type="password"]'
await rejects('password欄の自動入力を拒否する', () => validateBrowserPlan(passwordSelector), /非機密selector/)

const nonLastCommit = copy(plan)
nonLastCommit.steps.push({ type: 'assert', selector: '#done', condition: 'visible' })
await rejects('最後以外のcommitを拒否する', () => validateBrowserPlan(nonLastCommit), /commitは最後/)
const multipleCommit = copy(plan)
multipleCommit.steps.splice(-1, 0, { type: 'commit', selector: '#confirm-submit', action: 'confirm' })
await rejects('複数commitを拒否する', () => validateBrowserPlan(multipleCommit), /最大1件|最後のstep/)
const noCommit = copy(plan)
noCommit.steps.pop()
await rejects('確定planにcommitがない場合を拒否する', () => validateBrowserPlan(noCommit), /commitが1件/)

const validExecution = {
  plan,
  mode: 'execute' as const,
  driver,
  approvedAction: action,
  approvedActionHash: workflowHash(action),
  databaseIdentity: { id: 'canonical-fixture', role: 'canonical' },
  reconciliation: { state: 'not_done' as const },
}
await rejects('本人承認hashが欠けた実行を拒否する', () => runBrowserPlan({ ...validExecution, approvedActionHash: undefined }), /action hash/)
await rejects('action内容が承認後に変わった実行を拒否する', () => runBrowserPlan({
  ...validExecution, approvedAction: { ...action, content: { ...action.content, motivation: '変更済み' } },
}), /action hash/)
await rejects('正本identity不一致を拒否する', () => runBrowserPlan({
  ...validExecution, databaseIdentity: { id: 'replica-fixture', role: 'replica' },
}), /正本DB identity/)
const missingKey = copy(plan)
missingKey.externalIdempotencyKey = ''
await rejects('外部冪等キーなしのplanを拒否する', () => runBrowserPlan({ ...validExecution, plan: missingKey }), /外部冪等キー/)
check('拒否された実行はDriverを呼ばない', driverCalls.length === 0)

const alreadyDone = await runBrowserPlan({
  ...validExecution, reconciliation: { state: 'done', receiptRef: 'receipt-fixture' },
})
check('reconcile済み操作は再実行しない', alreadyDone.status === 'already_done' && alreadyDone.receiptRef === 'receipt-fixture' && driverCalls.length === 0)
await rejects('成否不明の操作を再実行しない', () => runBrowserPlan({
  ...validExecution, reconciliation: { state: 'unknown' },
}), /成否が不明/)
check('done/unknownの再照合結果ではDriverを呼ばない', driverCalls.length === 0)

const completed = await runBrowserPlan(validExecution)
check('全gate一致時だけ操作を順番どおり実行する', completed.status === 'completed'
  && driverCalls.map((call) => call.type).join(',') === 'navigate,assert,fill,fill,click,assert,commit')
check('Driverへは承認actionから解決した値だけを渡す', driverCalls[2]?.value === action.target.email
  && driverCalls[3]?.value === action.content.motivation && driverCalls[5]?.value === action.target.email)
check('全stepに同じ外部冪等キーを渡す', driverCalls.every((call) => call.key === plan.externalIdempotencyKey))

driverCalls.length = 0
const checkpointPlan: BrowserOperationPlan = {
  ...copy(plan), effect: 'none',
  steps: [
    { type: 'navigate', url: 'https://jobs.example.test/apply/login' },
    { type: 'checkpoint', kind: 'mfa', message: '本人がMFAを完了してください' },
    { type: 'click', selector: '#continue' },
  ],
}
const checkpoint = await runBrowserPlan({ ...validExecution, plan: checkpointPlan })
check('MFA checkpointで本人へ引き渡し後続操作を止める', checkpoint.status === 'needs_user'
  && checkpoint.checkpoint === 'mfa' && driverCalls.map((call) => call.type).join(',') === 'navigate')

let failureCalls = 0
const failure = await runBrowserPlan({
  ...validExecution,
  driver: {
    async run() {
      failureCalls++
      throw new Error('synthetic page failure that must not escape')
    },
  },
})
check('Driver例外は詳細を漏らさずunknownと再照合要求を返す', failure.status === 'unknown'
  && failure.reason === 'driver_failed' && failure.needsReconcile)
check('Driver失敗を自動再試行しない', failureCalls === 1)

let unknownCalls = 0
const unknown = await runBrowserPlan({
  ...validExecution,
  driver: {
    async run() {
      unknownCalls++
      return { state: 'unknown' }
    },
  },
})
check('Driverの成否不明を再照合待ちにする', unknown.status === 'unknown'
  && unknown.reason === 'driver_unknown' && unknown.needsReconcile)
check('成否不明も自動再試行しない', unknownCalls === 1)

console.log(`${checks}件のブラウザ操作計画チェックを通過`)
