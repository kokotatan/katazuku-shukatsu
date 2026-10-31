/** 第三者宛メールを送信前に正本・元メール・文面・予定・添付とaction hashで検査する。 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb } from '../src/db.js'
import { applyMail } from '../src/db-apply-mail.js'
import { applyDiff } from '../src/db-apply.js'
import { saveBasicProfile } from '../src/platform.js'
import {
  buildWorkspaceSendCall,
  emailIdentityFromProfile,
  hasScheduleCommitmentLanguage,
  preflightThirdPartyEmail,
  professionalEmailIssues,
  executeApprovedThirdPartyEmail,
  type ThirdPartyEmailAction,
} from '../src/third-party-email.js'
import { getDatabaseContext } from '../src/schedule.js'
import {
  beginWorkflowStep,
  completeWorkflowStep,
  decideWorkflowApproval,
  getWorkflowRun,
  loadWorkflowContract,
  openWorkflowStore,
  requestWorkflowApproval,
  startWorkflowRun,
  workflowHash,
} from '../src/workflow-control.js'

const root = mkdtempSync(join(tmpdir(), 'katazuku-third-party-email-'))
const db = openDb(join(root, 'katazuku.db'))
try {
  applyDiff(db, [{ name: 'Example株式会社', stage: 'interview', position: '新卒採用' }])
  const selection = db.prepare('SELECT id FROM selection').get() as { id: number }
  applyMail(db, { items: [{
    id: 'message-example', receivedAt: '2099-01-01T00:00:00Z', subject: '面談のご案内',
    company: 'Example株式会社', position: '新卒採用', sourceRef: 'gmail:message-example',
  }] })
  saveBasicProfile(db, {
    name: '就活 太郎', university: '架空大学', phone: 'configured-phone', email: 'user@example.com',
  }, 'fixture')

  const body = [
    'Example株式会社', '採用ご担当者様', '', 'お世話になっております。',
    '架空大学の就活 太郎です。', '', 'ご連絡いただきありがとうございます。',
    '', '何卒よろしくお願いいたします。', '', '就活 太郎',
    'TEL: configured-phone', 'Mail: user@example.com',
  ].join('\n')
  const action: ThirdPartyEmailAction = {
    actionType: 'gmail.send',
    target: {
      userGoogleEmail: 'user@example.com', to: ['recruit@example.com'], companyName: 'Example株式会社',
      selectionId: selection.id,
    },
    content: {
      subject: 'Re: 面談のご案内', body, threadId: 'thread-example', sourceMessageId: 'message-example',
      scheduleCommitments: [],
    },
    effectiveAt: 'immediate', notification: 'recruit@example.comへ返信される',
  }

  assert.deepEqual(emailIdentityFromProfile({ fullName: '氏名', affiliation: '所属', mail: 'a@example.com', tel: '000' }), {
    name: '氏名', affiliation: '所属', email: 'a@example.com', phone: '000',
  })
  assert.deepEqual(professionalEmailIssues(body, emailIdentityFromProfile({
    name: '就活 太郎', university: '架空大学', phone: '000', email: 'user@example.com',
  })), [])
  const preflight = preflightThirdPartyEmail(db, action, { now: new Date('2099-01-01T00:05:00Z') })
  assert.equal(preflight.ok, true, preflight.issues.join(' / '))
  assert.equal(preflight.mailItemId, 'message-example')
  assert.equal(preflight.actionHash, workflowHash(action))

  const call = buildWorkspaceSendCall(action)
  assert.equal(call.name, 'send_gmail_message')
  assert.equal(call.arguments.user_google_email, 'user@example.com')
  assert.equal(call.arguments.to, 'recruit@example.com')
  assert.equal(call.arguments.thread_id, 'thread-example')
  assert.equal(call.arguments.include_signature, false)

  const commitment = {
    ...action,
    content: { ...action.content, body: `${body}\n1月10日10時から参加いたします。` },
  }
  assert.equal(hasScheduleCommitmentLanguage(commitment), true)
  const withoutCommitment = preflightThirdPartyEmail(db, commitment)
  assert.equal(withoutCommitment.ok, false)
  assert(withoutCommitment.issues.some((issue) => issue.includes('scheduleCommitments')))

  const cancellation = {
    ...action,
    content: { ...action.content, body: `${body}\n1月10日の面談は辞退いたします。` },
  }
  assert.equal(hasScheduleCommitmentLanguage(cancellation), false, '過去の日時を取り消す返信は新しい予定確定ではない')

  const disclosure = professionalEmailIssues(body.replace('ご連絡いただきありがとうございます。', '他社の面接があるため変更を希望します。'), {
    name: '就活 太郎', affiliation: '架空大学', email: 'user@example.com', phone: '000',
  })
  assert(disclosure.some((issue) => issue.includes('他社の選考情報')))

  const unknownMail = preflightThirdPartyEmail(db, {
    ...action, content: { ...action.content, sourceMessageId: 'missing-message' },
  })
  assert.equal(unknownMail.ok, false)
  assert(unknownMail.issues.some((issue) => issue.includes('元メール')))

  const missingAttachment = preflightThirdPartyEmail(db, {
    ...action,
    content: { ...action.content, attachments: [{ path: join(root, 'missing-secret-name.pdf'), filename: '提出物.pdf', mimeType: 'application/pdf' }] },
  })
  assert.equal(missingAttachment.ok, false)
  assert(missingAttachment.issues.some((issue) => issue.includes('提出物.pdf')))
  assert(!missingAttachment.issues.join('\n').includes('missing-secret-name'), '診断へローカルpathを出さない')

  const contract = loadWorkflowContract(join(dirname(fileURLToPath(import.meta.url)), '..', 'workflows', 'third-party-email.json'))
  const approvedStore = (runId: string) => {
    const store = openWorkflowStore(':memory:')
    const target = getDatabaseContext(db)
    startWorkflowRun(store, contract, action, target, runId)
    beginWorkflowStep(store, contract, runId, 'validate', 'executor', { input: action, targetDatabase: target })
    completeWorkflowStep(store, contract, runId, 'validate', 'executor', { output: preflight, targetDatabase: target })
    requestWorkflowApproval(store, contract, runId, 'approve', action, target)
    decideWorkflowApproval(store, contract, runId, 'approve', action, 'approved', target)
    return store
  }

  const sendStore = approvedStore('email:send-once')
  try {
    let reconcileCount = 0
    let sendCount = 0
    const result = await executeApprovedThirdPartyEmail({
      canonicalDb: db, workflowStore: sendStore, contract, runId: 'email:send-once', action,
      adapter: {
        async reconcile() {
          reconcileCount++
          return reconcileCount === 1 ? { state: 'not_sent' } : { state: 'sent', receiptRef: 'sent-message-1' }
        },
        async send() { sendCount++ },
      },
    })
    assert.deepEqual(result, { reconciled: false, receiptRef: 'sent-message-1', actionHash: workflowHash(action) })
    assert.equal(sendCount, 1)
    assert.equal(getWorkflowRun(sendStore, 'email:send-once').run.status, 'done')
    assert.equal(getWorkflowRun(sendStore, 'email:send-once').approval?.status, 'consumed')
  } finally {
    sendStore.close()
  }

  const reconcileStore = approvedStore('email:already-sent')
  try {
    let sendCount = 0
    const result = await executeApprovedThirdPartyEmail({
      canonicalDb: db, workflowStore: reconcileStore, contract, runId: 'email:already-sent', action,
      adapter: {
        async reconcile() { return { state: 'sent', receiptRef: 'existing-sent-message' } },
        async send() { sendCount++ },
      },
    })
    assert.equal(result.reconciled, true)
    assert.equal(sendCount, 0, '既にSENTで一致したメールを再送しない')
  } finally {
    reconcileStore.close()
  }

  const unknownStore = approvedStore('email:unknown')
  try {
    let sendCount = 0
    await assert.rejects(() => executeApprovedThirdPartyEmail({
      canonicalDb: db, workflowStore: unknownStore, contract, runId: 'email:unknown', action,
      adapter: {
        async reconcile() { return { state: 'unknown' } },
        async send() { sendCount++ },
      },
    }), /再送しません/)
    assert.equal(sendCount, 0)
    assert.equal(getWorkflowRun(unknownStore, 'email:unknown').run.status, 'unknown')
  } finally {
    unknownStore.close()
  }

  const fixture = openDb(':memory:')
  try {
    const fixtureResult = preflightThirdPartyEmail(fixture, action, {
      identity: { name: '就活 太郎', affiliation: '架空大学' },
    })
    assert.equal(fixtureResult.ok, false)
    assert(fixtureResult.issues.some((issue) => issue.includes('正本DB')))
  } finally {
    fixture.close()
  }

  console.log('第三者メール: 正本・元メール・文面・予定・添付・承認hash・SENT照合・不明時再送禁止を確認')
} finally {
  db.close()
  rmSync(root, { recursive: true, force: true })
}
