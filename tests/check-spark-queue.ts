import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SparkQueue, validSparkTaskUrl } from '../src/spark-queue.js'
import { sparkRpc } from '../src/spark-mcp.js'
import { allowedSparkRemoteRequest, filterSparkRemoteResponse } from '../src/spark-remote-policy.js'
let now = Date.parse('2026-09-26T03:00:00Z')
const dir = mkdtempSync(join(tmpdir(), 'spark-queue-'))
const q = new SparkQueue(join(dir, 'queue.db'), () => now)
const q2 = new SparkQueue(join(dir, 'queue.db'), () => now)
const url = 'https://gemini.google.com/u/1/spark/chat/example-task'
try {
  const a = q.enqueue('example:a', 'document', '架空資料')
  assert.equal(q.enqueue('example:a', 'document', '架空資料').runId, a.runId)
  assert.throws(() => q.enqueue('example:a', 'document', '差し替え'))
  const c = q.claim()!
  assert.equal(c.operation, 'dispatch')
  assert.equal(q2.claim(), null)
  assert.throws(() => q.report(a.runId, 'wrong', { state: 'waiting', taskUrl: url }))
  assert.throws(() => q.report(a.runId, c.lease, { state: 'waiting' }))
  assert.throws(() => q.report(a.runId, c.lease, { state: 'waiting', taskUrl: 'https://example.com/' }))
  q.report(a.runId, c.lease, { state: 'waiting', taskUrl: url })
  assert.equal(q.claim(), null)
  now += 10 * 60_000
  const p = q2.claim()!
  assert.equal(p.operation, 'poll')
  assert.throws(() => q.report(a.runId, p.lease, { state: 'waiting', taskUrl: url + 'changed' }))
  now += 11 * 60_000
  assert.equal(q.status(a.runId).state, 'awaiting')
  assert.throws(() => q.report(a.runId, p.lease, { state: 'waiting', taskUrl: url }))
  const done = q.claim()!
  const job = JSON.parse(q.get(a.runId).job)
  const payload = { summary: '架空', content: '内容', sources: [], unknowns: [] }
  const response = JSON.stringify({ runId: job.runId, inputHash: job.inputHash, payload })
  assert.throws(() => q.report(a.runId, done.lease, { state: 'complete', response: '{}' }))
  assert.equal(q.report(a.runId, done.lease, { state: 'complete', response }).state, 'needs_review')
  assert.throws(() => q.report(a.runId, done.lease, { state: 'complete', response }))
  assert.deepEqual(q.status(a.runId).result, payload)
  const b = q.enqueue('example:b', 'research', '架空の会社A')
  q.claim()
  now += 11 * 60_000
  assert.equal(q.status(b.runId).state, 'blocked')
  assert.equal(q.claim(), null)
  q.reconcile(b.runId, url)
  assert.equal(q.claim()!.operation, 'poll')
  now += 25 * 3600_000
  assert.equal(q.status(b.runId).state, 'expired')
  assert.throws(() => q.reconcile(b.runId, url))
  for (const u of ['http://gemini.google.com/spark/chat/x', url + '?token=x', url + '#x', 'https://gemini.google.com.evil.test/spark/chat/x']) assert.equal(validSparkTaskUrl(u), false)
  const rpc = (method: string, params?: unknown) => sparkRpc(q, { jsonrpc: '2.0', id: 1, method, params }) as any
  assert.equal(rpc('initialize').result.protocolVersion, '2025-06-18')
  assert.equal(rpc('tools/list').result.tools.length, 5)
  assert.equal(rpc('tools/call', { name: 'shell', arguments: {} }).error.code, -32602)
  assert.equal(rpc('tools/call', { name: 'spark_enqueue', arguments: { requestKey: 'x', kind: 'send', input: '送信' } }).error.code, -32602)
  assert.equal(rpc('tools/call', { name: 'spark_list', arguments: { approved: true } }).error.code, -32602)
  assert.equal(sparkRpc(q, { jsonrpc: '2.0', method: 'notifications/initialized' }), undefined)
  assert.equal(rpc('tools/call', { name: 'spark_list' }).result.isError, false)
  for (const name of ['spark_claim', 'spark_report', 'shell', 'approve', 'send']) {
    assert.equal(allowedSparkRemoteRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name } }), false)
  }
  assert.equal(allowedSparkRemoteRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'spark_enqueue' } }), true)
  assert.equal(allowedSparkRemoteRequest([]), false)
  const remote = filterSparkRemoteResponse(rpc('tools/list')) as any
  assert.deepEqual(remote.result.tools.map((t: any) => t.name), ['spark_enqueue', 'spark_status', 'spark_list'])
  console.log('Spark queue/MCP: 冪等・二重claim・リース・クラッシュ回復・期限・URL・入力境界 OK')
} finally { q.close(); q2.close(); rmSync(dir, { recursive: true, force: true }) }
