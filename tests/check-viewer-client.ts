import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { openDb } from '../src/db.js'
import { buildSnapshot } from '../src/snapshot.js'
import { ViewerClient, ViewerError } from '../src/viewer-client.js'
import { boundedJson, connectionOrigin } from '../src/http-boundary.js'

const db = openDb(':memory:')
const snapshot = JSON.parse(JSON.stringify(buildSnapshot(db)))
db.close()
const saved = new Map<string, string>()
const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value) }, removeItem: (key: string) => { saved.delete(key) } }
const calls: { url: string; options?: RequestInit }[] = []
const id = 'a'.repeat(32)
const expiresAt = Math.floor((Date.now() + 30 * 60_000) / 1000) * 1000
const token = `ktz_session_${expiresAt / 1000}_${randomBytes(32).toString('base64url')}`
let dataStatus = 200
let responseId = id
let deferred: (() => void) | undefined
let deferData = false
const transport: typeof fetch = async (input, options) => {
  const url = String(input)
  calls.push({ url, options })
  if (url.endsWith('/api/info')) return Response.json({ protocolVersion: 1, instanceId: responseId })
  if (url.endsWith('/api/session')) return Response.json(options?.method === 'DELETE' ? { ok: true } : { protocolVersion: 1, instanceId: id, deviceName: 'テスト専用PC', token, expiresAt })
  if (deferData) await new Promise<void>(resolve => { deferred = resolve })
  return Response.json(dataStatus === 200 ? snapshot : { error: 'test' }, { status: dataStatus })
}
const viewer = new ViewerClient({ fetch: transport, storage })
let passed = 0
async function check(name: string, test: () => Promise<void> | void) { await test(); console.log(`PASS ${++passed}: ${name}`) }
const connect = () => viewer.connect('https://data.example.com', { readKey: 'test-only-input' })
try {
  await check('未接続の画面は通信も代替データの読取もしない', async () => {
    await assert.rejects(viewer.data(), error => error instanceof ViewerError && error.kind === 'disconnected')
    assert.equal(calls.length, 0)
  })
  await check('接続先の制限は認証値を送る前に適用する', async () => {
    for (const invalid of ['http://data.example.com', 'ftp://localhost', 'https://user:pass@data.example.com', 'https://data.example.com/?key=value', 'https://data.example.com/path', 'https://data.example.com/#value']) assert.throws(() => connectionOrigin(invalid))
    assert.equal(connectionOrigin('http://127.0.0.1:18471'), 'http://127.0.0.1:18471')
    await assert.rejects(viewer.connect('https://data.example.com/?key=value', { readKey: 'test-only-input' }))
    assert.equal(calls.length, 0)
  })
  await connect()
  await check('長期キーとデータは保存せず、リダイレクト先へ認証を転送しない', async () => {
    assert.deepEqual(await viewer.data(), snapshot)
    const stored = [...saved.values()].join('')
    assert.ok(!stored.includes('test-only-input') && !stored.includes('selections'))
    assert.ok(calls.every(call => call.options?.redirect === 'error' && call.options?.credentials === 'omit' && call.options?.referrerPolicy === 'no-referrer'))
    assert.ok(calls.every(call => !call.url.includes(token) && !call.url.includes('test-only-input')))
  })
  await check('解除直後に状態を消し、遅れて届くデータを採用しない', async () => {
    deferData = true
    const pending = viewer.data()
    const rejected = assert.rejects(pending, error => error instanceof DOMException && error.name === 'AbortError')
    while (!deferred) await new Promise(resolve => setTimeout(resolve, 1))
    const disconnecting = viewer.disconnect()
    assert.equal(viewer.getState().connection, null)
    assert.equal(saved.size, 0)
    deferred(); await rejected; await disconnecting
    deferData = false
  })
  await connect()
  await check('保存先の識別子が変わったら認証を送らずに解除する', async () => {
    responseId = 'b'.repeat(32)
    const before = calls.length
    await assert.rejects(viewer.data())
    assert.equal(viewer.getState().connection, null)
    assert.deepEqual(calls.slice(before).map(call => new URL(call.url).pathname), ['/api/info'])
    responseId = id
  })
  await connect()
  await check('401は保存済みセッションも解除し、未同期とは分ける', async () => {
    dataStatus = 404
    await assert.rejects(viewer.data(), error => error instanceof ViewerError && error.kind === 'not-synced')
    assert.ok(viewer.getState().connection)
    dataStatus = 401
    await assert.rejects(viewer.data(), error => error instanceof ViewerError && error.kind === 'unauthorized')
    assert.equal(saved.size, 0); assert.equal(viewer.getState().connection, null)
    dataStatus = 200
  })
  await check('不正・期限切れの保存状態は自動接続しない', async () => {
    saved.set('katazuku.viewer.session.v1', JSON.stringify({ origin: 'https://data.example.com', instanceId: id, deviceName: 'テスト', token, expiresAt: 1 }))
    const restored = new ViewerClient({ storage, fetch: transport })
    assert.equal(restored.getState().connection, null); assert.equal(saved.size, 0)
    restored.dispose()
  })
  await check('本文の上限とJSON形式を検証し、圧縮による長さの差は許容する', async () => {
    await assert.rejects(boundedJson(new Response('x'.repeat(50), { headers: { 'content-type': 'application/json' } }), 20))
    await assert.rejects(boundedJson(new Response('<html>', { headers: { 'content-type': 'text/html' } }), 100))
    assert.deepEqual(await boundedJson(new Response('{"ok":true}', { headers: { 'content-type': 'application/json', 'content-length': '3' } }), 100), { ok: true })
  })
  console.log(`閲覧クライアント: ${passed}項目を通過`)
} finally { viewer.dispose() }
