import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/db.js'
import { applyCalendar } from '../src/db-apply-calendar.js'
import { applyApplicationEvent, startApplication } from '../src/application.js'
import { katazukuRpc, KatazukuMcpServer } from '../src/katazuku-mcp.js'
import { workflowHash } from '../src/workflow-control.js'

const root = mkdtempSync(join(tmpdir(), 'katazuku-mcp-'))
const dbPath = join(root, 'katazuku.db')
const workflowStorePath = join(root, 'workflow.db')
const now = new Date('2099-01-01T00:00:00+09:00')
const db = openDb(dbPath)
applyCalendar({ events: [{
  externalId: 'calendar-example-1', title: '一次面接', startAt: '2099-01-01T10:00:00+09:00',
  endAt: '2099-01-01T11:00:00+09:00', company: 'Example株式会社', position: '新卒採用', kind: '面接',
}] }, db)
const appointmentId = Number((db.prepare('SELECT id FROM appointment WHERE external_id = ?').get('calendar-example-1') as { id: number }).id)
const application = startApplication(db, {
  runId: 'application:example:1', company: 'Example株式会社', position: '新卒採用',
  materialsRef: 'materials:example', sourceRef: 'source:example-application', startedAt: '2098-12-30T00:00:00Z',
})
applyApplicationEvent(db, {
  eventId: 'event:example-assessment', runId: application.runId, type: 'assessment_detected',
  at: '2098-12-31T00:00:00Z', sourceRef: 'source:example-assessment', summary: '適性検査を検知',
  assessment: {
    testType: 'SPI', provider: 'Example Test', url: 'https://example.com/assessment', deadline: '2099-01-03T00:00:00+09:00',
    durationMinutes: 65, allowedItems: ['筆記用具'], environmentStatus: '未確認', status: 'pending', notes: '本人が受験する',
  },
})
db.close()

const rpc = async (server: KatazukuMcpServer, method: string, params?: unknown) => katazukuRpc(server, { jsonrpc: '2.0', id: 1, method, params }) as Promise<any>
try {
  const reader = new KatazukuMcpServer({ dbPath, workflowStorePath, scopes: ['read'], now: () => now })
  const listed = await rpc(reader, 'tools/list')
  const names = listed.result.tools.map((tool: { name: string }) => tool.name)
  assert(names.includes('katazuku_today'))
  assert(names.includes('katazuku_work_queue'))
  assert(names.includes('katazuku_applications'))
  assert(names.includes('katazuku_assessments'))
  assert(!names.includes('katazuku_snapshot'))
  assert(!names.includes('katazuku_career_meetings'))
  assert(!names.includes('katazuku_record_mail'))
  const today = await rpc(reader, 'tools/call', { name: 'katazuku_today', arguments: {} })
  assert.equal(today.result.isError, false)
  assert(today.result.content[0].text.includes('一次面接'))
  assert(today.result.content[0].text.includes('10:00-11:00'), 'OSのタイムゾーンによらず日本時間で返す')
  const preparationStatus = await rpc(reader, 'tools/call', { name: 'katazuku_meeting_preparations', arguments: {} })
  const preparationStatusText = preparationStatus.result.content[0].text
  assert(preparationStatusText.includes('Example株式会社'))
  assert(!preparationStatusText.includes('contextHash'), 'read scopeへ準備用の根拠hashを出さない')
  const applications = await rpc(reader, 'tools/call', { name: 'katazuku_applications', arguments: {} })
  const assessments = await rpc(reader, 'tools/call', { name: 'katazuku_assessments', arguments: {} })
  const calendarOutbox = await rpc(reader, 'tools/call', { name: 'katazuku_calendar_outbox', arguments: {} })
  assert.equal(applications.result.isError, false)
  assert.equal(assessments.result.isError, false)
  assert.equal(calendarOutbox.result.isError, false)
  const applicationData = JSON.parse(applications.result.content[0].text)
  const assessmentData = JSON.parse(assessments.result.content[0].text)
  assert.equal(applicationData[0].id, 'application:example:1')
  assert.equal(assessmentData[0].testType, 'SPI')
  assert.deepEqual(assessmentData[0].allowedItems, ['筆記用具'])
  assert(!JSON.stringify(assessmentData).match(/(?:question|answer|問題|解答)/i))
  const denied = await rpc(reader, 'tools/call', { name: 'katazuku_record_mail', arguments: { items: [] } })
  assert.equal(denied.result.isError, true)

  const full = new KatazukuMcpServer({ dbPath, workflowStorePath, scopes: ['read', 'write', 'sensitive', 'actions'], now: () => now })
  const mail = await rpc(full, 'tools/call', { name: 'katazuku_record_mail', arguments: { items: [{
    id: 'message-example', receivedAt: '2098-12-31T10:00:00Z', subject: '面談のご案内',
    summary: '日程確認が必要', needsAction: true, company: 'Example株式会社', sourceRef: 'gmail:message-example',
  }] } })
  assert.equal(mail.result.isError, false)
  const workQueue = await rpc(full, 'tools/call', { name: 'katazuku_work_queue', arguments: {} })
  const workQueueData = JSON.parse(workQueue.result.content[0].text)
  assert.equal(workQueue.result.isError, false)
  assert.equal(workQueueData.counts.mail, 1)
  assert.equal(workQueueData.mail[0].id, 'message-example')
  assert(!JSON.stringify(workQueueData).match(/(?:password|question|answer|問題|解答)/i))
  const careerMeetings = await rpc(full, 'tools/call', { name: 'katazuku_career_meetings', arguments: {} })
  assert.equal(careerMeetings.result.isError, false)
  const snapshot = await rpc(full, 'tools/call', { name: 'katazuku_snapshot', arguments: {} })
  assert(JSON.parse(snapshot.result.content[0].text).mailItems.some((item: { id: string }) => item.id === 'message-example'))
  const research = await rpc(full, 'tools/call', { name: 'katazuku_record_people_research', arguments: {
    sourceRef: 'official:example-team', researchedAt: '2098-12-31T12:00:00Z',
    people: [{ name: '採用担当A', company: 'Example株式会社', role: '採用担当', category: '採用担当', notes: ['公式チームページに掲載'], confidence: 0.9 }],
  } })
  assert.equal(research.result.isError, false)
  const companyResearch = await rpc(full, 'tools/call', { name: 'katazuku_record_company_research', arguments: {
    company: 'Example株式会社', summary: '公式情報に基づく企業研究', facts: { business: 'example' },
    sources: [{ title: '公式会社情報', url: 'https://example.com/company' }],
    researchedAt: '2098-12-31T13:00:00Z', sourceRef: 'research:example-company',
  } })
  assert.equal(companyResearch.result.isError, false)
  const interview = await rpc(full, 'tools/call', { name: 'katazuku_record_interview', arguments: {
    runId: 'meeting:example:1', appointmentId, company: 'Example株式会社', position: '新卒採用',
    occurredAt: '2099-01-01T11:00:00+09:00', title: '一次面接', summary: '面接の構造化要約',
    questions: [{ question: '志望理由', answer: '事業への関心' }],
    people: [{ name: '面接官B', company: 'Example株式会社', role: '面接官', notes: ['次回は業務理解を深掘り'], confidence: 0.9 }],
    profileSuggestions: [{ field: 'careerAxis', value: '顧客価値', confidence: 0.8 }], followUps: ['企業研究を更新'],
  } })
  assert.equal(interview.result.isError, false)
  assert.equal(JSON.parse(interview.result.content[0].text).created, true)
  const interviewRepeated = await rpc(full, 'tools/call', { name: 'katazuku_record_interview', arguments: {
    runId: 'meeting:example:1', appointmentId, company: 'Example株式会社', occurredAt: '2099-01-01T11:00:00+09:00',
    title: '一次面接', summary: '面接の構造化要約',
  } })
  assert.equal(JSON.parse(interviewRepeated.result.content[0].text).created, false)
  const pathRejected = await rpc(full, 'tools/call', { name: 'katazuku_record_interview', arguments: {
    runId: 'meeting:path:1', appointmentId, company: 'Example株式会社', occurredAt: '2099-01-01T11:00:00+09:00',
    title: '一次面接', summary: 'pathは許可しない', transcriptPath: 'C:\\secret.txt',
  } })
  assert.equal(pathRejected.result.isError, true)
  const afterWrites = await rpc(full, 'tools/call', { name: 'katazuku_snapshot', arguments: {} })
  const afterWritesData = JSON.parse(afterWrites.result.content[0].text)
  assert(afterWritesData.dossiers.some((item: { company: string }) => item.company === 'Example株式会社'))
  assert(afterWritesData.interviews.some((item: { sourceRef: string }) => item.sourceRef === 'meeting:example:1'))
  const excluded = await rpc(full, 'tools/call', { name: 'katazuku_exclude_company', arguments: {
    name: 'Example株式会社', reason: '本人が今後の管理対象外と決定', ref: 'conversation:example-exclusion',
  } })
  assert.equal(excluded.result.isError, false)
  assert.equal(JSON.parse(excluded.result.content[0].text).selections, 1)

  const action = {
    actionType: 'email.send', target: { to: ['recipient@example.com'] },
    content: { subject: 'Re: 面談のご案内', body: '確認済み本文' },
    effectiveAt: 'immediate', notification: 'recipient@example.comへ送信される',
  }
  const prepared = await rpc(full, 'tools/call', { name: 'katazuku_prepare_action', arguments: {
    runId: 'mcp:example:1', sourceRef: 'gmail:message-example', action,
  } })
  assert.equal(prepared.result.isError, false)
  const preparedData = JSON.parse(prepared.result.content[0].text)
  assert.equal(preparedData.run.status, 'needs_user')
  assert.equal(preparedData.approval.status, 'requested')

  const repeated = await rpc(full, 'tools/call', { name: 'katazuku_prepare_action', arguments: {
    runId: 'mcp:example:1', sourceRef: 'gmail:message-example', action,
  } })
  assert.equal(repeated.result.isError, false)
  const changed = await rpc(full, 'tools/call', { name: 'katazuku_prepare_action', arguments: {
    runId: 'mcp:example:1', sourceRef: 'gmail:message-example', action: { ...action, effectiveAt: '2099-01-02T00:00:00Z' },
  } })
  assert.equal(changed.result.isError, true)

  const status = await rpc(full, 'tools/call', { name: 'katazuku_action_status', arguments: { runId: 'mcp:example:1' } })
  assert.equal(JSON.parse(status.result.content[0].text).approval.status, 'requested')

  const museEmailAction = {
    actionType: 'email.send',
    target: {
      provider: 'icloud-mail', executor: 'muse-email-connector', senderEmail: 'contact@example.com',
      context: 'business', to: ['joeri@example.com'], counterpartyName: 'Agensi',
    },
    content: {
      subject: 'Re: Agensi x katazuku-shukatsu',
      body: 'Hi Joeri,\n\nThank you for reaching out.\n\nBest,\nKotaro Okuyama',
      threadId: 'muse-thread-1', sourceMessageId: 'message-example', scheduleCommitments: [],
    },
    effectiveAt: 'immediate', notification: 'Museの承認後にiCloud Mailから返信する',
  }
  const musePrepared = await rpc(full, 'tools/call', { name: 'katazuku_prepare_muse_email', arguments: {
    runId: 'muse-email-1', sourceRef: 'muse-email:INBOX:message-example', action: museEmailAction,
  } })
  assert.equal(musePrepared.result.isError, false)
  const musePreparedData = JSON.parse(musePrepared.result.content[0].text)
  assert.equal(musePreparedData.workflow.run.status, 'needs_user')
  assert.equal(musePreparedData.dispatch.requiresSensitiveWriteApproval, true)
  assert.equal(musePreparedData.dispatch.requiresSentReconciliation, true)
  const museResult = {
    state: 'sent', actionHash: workflowHash(museEmailAction), approvalId: 'muse-approval-1',
    accountEmail: 'contact@example.com', to: ['joeri@example.com'],
    subjectHash: workflowHash(museEmailAction.content.subject), bodyHash: workflowHash(museEmailAction.content.body),
    threadId: 'muse-thread-1', sourceMessageId: 'message-example', sentMessageId: 'muse-sent-1',
    reconciledMessageId: 'muse-sent-1', sentAt: now.toISOString(), evidenceRef: 'muse-email:sent:muse-sent-1', errorCode: '',
  }
  const museRecorded = await rpc(full, 'tools/call', { name: 'katazuku_record_muse_email_result', arguments: {
    runId: 'muse-email-1', action: museEmailAction, result: museResult,
  } })
  assert.equal(museRecorded.result.isError, false)
  assert.equal(JSON.parse(museRecorded.result.content[0].text).workflow.run.status, 'done')
  const museStatus = await rpc(full, 'tools/call', { name: 'katazuku_muse_email_status', arguments: { runId: 'muse-email-1' } })
  assert.equal(JSON.parse(museStatus.result.content[0].text).result.sentMessageId, 'muse-sent-1')
  const museRepeated = await rpc(full, 'tools/call', { name: 'katazuku_record_muse_email_result', arguments: {
    runId: 'muse-email-1', action: museEmailAction, result: museResult,
  } })
  assert.equal(JSON.parse(museRepeated.result.content[0].text).workflow.run.status, 'done')
  const museMismatch = await rpc(full, 'tools/call', { name: 'katazuku_record_muse_email_result', arguments: {
    runId: 'muse-email-1', action: museEmailAction, result: { ...museResult, bodyHash: '0'.repeat(64) },
  } })
  assert.equal(museMismatch.result.isError, true)

  const unknownAction = { ...museEmailAction, content: { ...museEmailAction.content, threadId: 'muse-thread-2' } }
  await rpc(full, 'tools/call', { name: 'katazuku_prepare_muse_email', arguments: {
    runId: 'muse-email-unknown', sourceRef: 'muse-email:INBOX:message-example', action: unknownAction,
  } })
  const unknownResult = {
    state: 'unknown', actionHash: workflowHash(unknownAction), approvalId: 'muse-approval-unknown', accountEmail: 'contact@example.com',
    to: ['joeri@example.com'], subjectHash: workflowHash(unknownAction.content.subject), bodyHash: workflowHash(unknownAction.content.body),
    threadId: 'muse-thread-2', sourceMessageId: 'message-example', sentMessageId: '', reconciledMessageId: '', sentAt: '',
    evidenceRef: 'muse-email:unknown:timeout', errorCode: 'connector_timeout',
  }
  const unknownWithoutApproval = await rpc(full, 'tools/call', { name: 'katazuku_record_muse_email_result', arguments: {
    runId: 'muse-email-unknown', action: unknownAction, result: { ...unknownResult, approvalId: '' },
  } })
  assert.equal(unknownWithoutApproval.result.isError, true)
  const unknownRecorded = await rpc(full, 'tools/call', { name: 'katazuku_record_muse_email_result', arguments: {
    runId: 'muse-email-unknown', action: unknownAction, result: unknownResult,
  } })
  const unknownData = JSON.parse(unknownRecorded.result.content[0].text)
  assert.equal(unknownData.workflow.run.status, 'needs_user')
  assert.equal(unknownData.reconciliationRequired, true)
  const unknownRepeated = await rpc(full, 'tools/call', { name: 'katazuku_prepare_muse_email', arguments: {
    runId: 'muse-email-unknown', sourceRef: 'muse-email:INBOX:message-example', action: unknownAction,
  } })
  assert.equal(JSON.parse(unknownRepeated.result.content[0].text).result.state, 'unknown')
  const shell = await rpc(full, 'tools/call', { name: 'shell', arguments: { command: 'echo test' } })
  assert.equal(shell.result.isError, true)
  console.log('katazuku MCP: scope分離・正本読取・冪等入力・個人情報scope・承認提案・任意コマンド拒否を確認')
} finally {
  rmSync(root, { recursive: true, force: true })
}
