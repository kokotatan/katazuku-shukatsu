import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { build } from 'esbuild'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'

// 許可・失効・R2条件付き書込を実際のWorkersローカルランタイムで試す。外部へは送信しない。
const bundled = await build({ entryPoints: ['cloudflare/worker.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral', external: ['node:*'], logLevel: 'silent' })
const secret = () => randomBytes(32).toString('base64url')
const readKey = secret(), writeKey = secret()
const appOrigin = 'https://app.example.com'
const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'test-viewer', modules: true, script: bundled.outputFiles[0].text, compatibilityDate: '2026-09-07', compatibilityFlags: ['nodejs_compat'],
  r2Buckets: ['PRIVATE_DATA'], bindings: { KATAZUKU_READ_SECRET: readKey, KATAZUKU_WRITE_SECRET: writeKey, KATAZUKU_ALLOWED_ORIGINS: `${appOrigin},https://other.example.com`, KATAZUKU_DEVICE_NAME: 'テスト専用PC' },
  ratelimits: { AUTH_LIMIT: { namespace_id: '1001', simple: { limit: 100, period: 60 } }, REQUEST_LIMIT: { namespace_id: '1002', simple: { limit: 500, period: 60 } } },
}] }))
const request = (path, options = {}) => mf.dispatchFetch(`https://data.example.com${path}`, { ...options, headers: { origin: appOrigin, ...options.headers } })
const send = (path, body, headers = {}, method = 'POST') => request(path, { method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
const auth = token => ({ authorization: `Bearer ${token}` })
let passed = 0
async function check(name, test) { await test(); console.log(`PASS ${++passed}: ${name}`) }
try {
  const info = await (await request('/api/info')).json()
  await check('未認証・長期キーの直接利用・URLキーは閲覧できない', async () => {
    assert.equal((await request('/api/data')).status, 401)
    assert.equal((await request('/api/data', { headers: auth(readKey) })).status, 401)
    assert.equal((await request('/api/data?key=forbidden')).status, 400)
  })
  await check('未許可originとnull originを拒否し、許可先だけへCORSを返す', async () => {
    for (const origin of ['null', 'https://bad.example.com', 'https://app.example.com.bad.example.com']) {
      const response = await request('/api/info', { headers: { origin } })
      assert.equal(response.status, 403); assert.equal(response.headers.get('access-control-allow-origin'), null)
    }
    const response = await request('/api/info')
    assert.equal(response.headers.get('access-control-allow-origin'), appOrigin)
    assert.equal(response.headers.get('cache-control'), 'no-store')
  })
  const sessionResponse = await send('/api/session', { instanceId: info.instanceId, readKey })
  assert.equal(sessionResponse.status, 200)
  const session = await sessionResponse.json()
  await check('接続先とoriginに結び付いた短期セッションだけを許可する', async () => {
    assert.ok(session.expiresAt > Date.now() && session.expiresAt <= Date.now() + 30 * 60_000)
    assert.equal((await request('/api/data', { headers: auth(session.token) })).status, 404)
    assert.equal((await request('/api/data', { headers: { ...auth(session.token), origin: 'https://other.example.com' } })).status, 401)
    assert.equal((await mf.dispatchFetch('https://other-data.example.com/api/data', { headers: { ...auth(session.token), origin: appOrigin } })).status, 401)
    assert.equal((await send('/api/session', { instanceId: '0'.repeat(32), readKey })).status, 409)
  })
  const source = randomUUID()
  const snapshot = { schemaVersion: 1, generatedAt: new Date().toISOString(), profile: {} }
  for (const key of ['companies', 'selections', 'appointments', 'events', 'enrichedEvents', 'activities', 'profileSuggestions', 'people', 'personNotes', 'interviews', 'submissions', 'dossiers', 'mailItems', 'pending', 'meetingRuns']) snapshot[key] = []
  const put = (body, extra = {}) => send('/api/push', body, { ...auth(writeKey), 'x-katazuku-source': source, ...extra }, 'PUT')
  await check('書込権限と競合条件がなければ保存しない', async () => {
    assert.equal((await send('/api/push', snapshot, auth(session.token), 'PUT')).status, 401)
    assert.equal((await put(snapshot)).status, 428)
    assert.equal((await put({ ...snapshot, demo: true }, { 'if-none-match': '*' })).status, 422)
    assert.equal((await put({ ...snapshot, profile: { password: 'test only' } }, { 'if-none-match': '*' })).status, 422)
  })
  const first = await put(snapshot, { 'if-none-match': '*' })
  assert.equal(first.status, 200)
  const { etag } = await first.json()
  await check('正しいデータを保存し、認証済み閲覧へ返す', async () => {
    const response = await request('/api/data', { headers: auth(session.token) })
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await response.json(), snapshot)
  })
  await check('古い版・別正本・初回書込の再実行を拒否する', async () => {
    assert.equal((await put(snapshot, { 'if-none-match': '*' })).status, 412)
    assert.equal((await put(snapshot, { 'if-match': etag, 'x-katazuku-source': randomUUID() })).status, 409)
    assert.equal((await put({ ...snapshot, generatedAt: '2020-01-01T00:00:00Z' }, { 'if-match': etag })).status, 409)
    assert.equal((await put(snapshot, { 'if-match': '"old-version"' })).status, 412)
    assert.equal((await put(snapshot, { 'if-match': etag })).status, 200)
  })
  await check('競合する同期は一つだけ成功し、途中や不正な入力で既存データを壊さない', async () => {
    const candidates = [1, 2].map(offset => ({ ...snapshot, generatedAt: new Date(Date.now() + offset * 1000).toISOString() }))
    const results = await Promise.all(candidates.map(body => put(body, { 'if-match': etag })))
    assert.deepEqual(results.map(r => r.status).sort(), [200, 412])
    const response = await request('/api/data', { headers: auth(session.token) })
    const saved = await response.json()
    assert.ok(candidates.some(candidate => candidate.generatedAt === saved.generatedAt))
    assert.equal((await request('/api/push', { method: 'PUT', headers: { ...auth(writeKey), 'x-katazuku-source': source, 'if-match': response.headers.get('etag'), 'content-type': 'application/json' }, body: '{"broken":' })).status, 400)
    assert.deepEqual(await (await request('/api/data', { headers: auth(session.token) })).json(), saved)
  })
  await check('端末連携のコードは同時に使っても一度だけ有効', async () => {
    const paired = await (await send('/api/pair', { origin: appOrigin }, auth(writeKey))).json()
    const outcomes = await Promise.all([1, 2].map(() => send('/api/session', { instanceId: paired.instanceId, pairingCode: paired.token })))
    assert.deepEqual(outcomes.map(r => r.status).sort(), [200, 401])
    assert.equal((await send('/api/session', { instanceId: paired.instanceId, pairingCode: paired.token })).status, 401)
  })
  await check('ログアウトしたセッションと期限切れのトークンは再利用できない', async () => {
    assert.equal((await request('/api/session', { method: 'DELETE', headers: auth(session.token) })).status, 200)
    assert.equal((await request('/api/data', { headers: auth(session.token) })).status, 401)
    const expired = `ktz_session_1000000000_${secret()}`
    assert.equal((await request('/api/data', { headers: auth(expired) })).status, 401)
  })
  await check('認証の試行が続く場合は再試行までの待ち時間を返す', async () => {
    let limited = false
    for (let attempt = 0; attempt < 120; attempt++) {
      const response = await send('/api/session', { instanceId: info.instanceId, readKey: 'invalid-test-value' })
      if (response.status === 429) { assert.equal(response.headers.get('retry-after'), '60'); limited = true; break }
      assert.equal(response.status, 401)
    }
    assert.ok(limited)
  })
  console.log(`Workerの認証・分離・同期: ${passed}項目を通過`)
} finally { await mf.dispose() }
