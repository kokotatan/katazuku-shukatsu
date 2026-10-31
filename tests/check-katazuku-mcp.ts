import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/db.js'
import { applyCalendar } from '../src/db-apply-calendar.js'
import { katazukuRpc, KatazukuMcpServer } from '../src/katazuku-mcp.js'

const root = mkdtempSync(join(tmpdir(), 'katazuku-mcp-'))
const dbPath = join(root, 'katazuku.db')
const workflowStorePath = join(root, 'workflow.db')
const now = new Date('2099-01-01T00:00:00+09:00')
const db = openDb(dbPath)
applyCalendar({ events: [{
  externalId: 'calendar-example-1', title: '一次面接', startAt: '2099-01-01T10:00:00+09:00',
  endAt: '2099-01-01T11:00:00+09:00', company: 'Example株式会社', position: '新卒採用', kind: '面接',
}] }, db)
db.close()

const rpc = async (server: KatazukuMcpServer, method: string, params?: unknown) => katazukuRpc(server, { jsonrpc: '2.0', id: 1, method, params }) as Promise<any>
try {
  const reader = new KatazukuMcpServer({ dbPath, workflowStorePath, scopes: ['read'], now: () => now })
  const listed = await rpc(reader, 'tools/list')
  const names = listed.result.tools.map((tool: { name: string }) => tool.name)
  assert(names.includes('katazuku_today'))
  assert(!names.includes('katazuku_snapshot'))
  assert(!names.includes('katazuku_record_mail'))
  const today = await rpc(reader, 'tools/call', { name: 'katazuku_today', arguments: {} })
  assert.equal(today.result.isError, false)
  assert(today.result.content[0].text.includes('一次面接'))
  const preparationStatus = await rpc(reader, 'tools/call', { name: 'katazuku_meeting_preparations', arguments: {} })
  const preparationStatusText = preparationStatus.result.content[0].text
  assert(preparationStatusText.includes('Example株式会社'))
  assert(!preparationStatusText.includes('contextHash'), 'read scopeへ準備用の根拠hashを出さない')
  const denied = await rpc(reader, 'tools/call', { name: 'katazuku_record_mail', arguments: { items: [] } })
  assert.equal(denied.result.isError, true)

  const full = new KatazukuMcpServer({ dbPath, workflowStorePath, scopes: ['read', 'write', 'sensitive', 'actions'], now: () => now })
  const mail = await rpc(full, 'tools/call', { name: 'katazuku_record_mail', arguments: { items: [{
    id: 'message-example', receivedAt: '2098-12-31T10:00:00Z', subject: '面談のご案内',
    summary: '日程確認が必要', needsAction: true, company: 'Example株式会社', sourceRef: 'gmail:message-example',
  }] } })
  assert.equal(mail.result.isError, false)
  const snapshot = await rpc(full, 'tools/call', { name: 'katazuku_snapshot', arguments: {} })
  assert(JSON.parse(snapshot.result.content[0].text).mailItems.some((item: { id: string }) => item.id === 'message-example'))
  const research = await rpc(full, 'tools/call', { name: 'katazuku_record_people_research', arguments: {
    sourceRef: 'official:example-team', researchedAt: '2098-12-31T12:00:00Z',
    people: [{ name: '採用担当A', company: 'Example株式会社', role: '採用担当', category: '採用担当', notes: ['公式チームページに掲載'], confidence: 0.9 }],
  } })
  assert.equal(research.result.isError, false)
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
  const shell = await rpc(full, 'tools/call', { name: 'shell', arguments: { command: 'echo test' } })
  assert.equal(shell.result.isError, true)
  console.log('katazuku MCP: scope分離・正本読取・冪等入力・個人情報scope・承認提案・任意コマンド拒否を確認')
} finally {
  rmSync(root, { recursive: true, force: true })
}
