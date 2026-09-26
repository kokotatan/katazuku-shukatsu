import assert from 'node:assert/strict'
import { randomBytes, createHash } from 'node:crypto'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const origin = process.env.SPARK_GATEWAY_TEST_ORIGIN || 'http://127.0.0.1:18801'
const live = Boolean(process.env.SPARK_GATEWAY_TEST_ORIGIN)
const ownerKey = live ? readFileSync('owner-key.local.txt', 'utf8').trim() : randomBytes(32).toString('base64url')
const bridgeToken = live ? JSON.parse(readFileSync('secrets.local.json', 'utf8')).BRIDGE_TOKEN : randomBytes(32).toString('base64url')
let child, socket
const digest = s => createHash('sha256').update(s).digest('base64url')
const req = (path, options = {}) => fetch(origin + path, { ...options, redirect: 'manual' })
const post = (path, value, extra = {}) => req(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(value) })
try {
  if (!live) {
    const config = JSON.parse(readFileSync('wrangler.example.jsonc', 'utf8'))
    config.vars = { PUBLIC_ORIGIN: origin, OWNER_KEY_SHA256: createHash('sha256').update(ownerKey).digest('hex'), BRIDGE_TOKEN: bridgeToken }
    delete config.secrets
    config.kv_namespaces[0].id = '0'.repeat(32)
    writeFileSync('test.local.json', JSON.stringify(config))
    child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--config', 'test.local.json', '--port', '18801', '--ip', '127.0.0.1'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    for (let i = 0; i < 60; i++) { try { if ((await req('/health')).ok) break } catch {} await delay(500) }
  }
  assert.equal((await post('/mcp', {})).status, 401)
  assert.equal((await req('/bridge')).status, 401)
  assert.equal((await post('/mcp', {}, { Origin: 'https://attacker.example' })).status, 403)
  const discovery = await (await req('/.well-known/oauth-authorization-server')).json()
  assert.equal(discovery.authorization_endpoint, origin + '/authorize')
  const clientRes = await post('/oauth/register', { client_name: '<script>悪意ある表示</script>', redirect_uris: ['https://client.example/callback'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] })
  assert.equal(clientRes.status, 201)
  const client = await clientRes.json()
  const verifier = randomBytes(32).toString('base64url')
  const params = new URLSearchParams({ client_id: client.client_id, redirect_uri: 'https://client.example/callback', response_type: 'code', resource: origin + '/mcp', scope: 'spark:tasks', state: 'synthetic-test', code_challenge: digest(verifier), code_challenge_method: 'S256' })
  const page = await req('/authorize?' + params)
  assert.equal(page.status, 200)
  const html = await page.text()
  assert.ok(!html.includes('<script>悪意'))
  const handle = html.match(/name="handle" value="([^"]+)"/)[1]
  const cookie = page.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
  const submit = (key, cookies = cookie) => req('/authorize', { method: 'POST', headers: { Origin: origin, Cookie: cookies, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ handle, ownerKey: key, decision: 'approve' }) })
  assert.equal((await submit('wrong')).status, 401)
  assert.equal((await submit(ownerKey, '')).status, 400)
  const approved = await submit(ownerKey)
  assert.equal(approved.status, 303)
  assert.equal((await submit(ownerKey)).status, 400)
  const callback = new URL(approved.headers.get('location'))
  assert.equal(callback.searchParams.get('state'), 'synthetic-test')
  const tokenBody = { grant_type: 'authorization_code', client_id: client.client_id, redirect_uri: 'https://client.example/callback', code: callback.searchParams.get('code'), code_verifier: verifier, resource: origin + '/mcp' }
  const tokenRes = await req('/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(tokenBody) })
  assert.equal(tokenRes.status, 200)
  const token = await tokenRes.json()
  const auth = { Authorization: 'Bearer ' + token.access_token }
  const forbidden = await (await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'spark_claim', arguments: {} } }, auth)).json()
  assert.equal(forbidden.error.code, -32601)
  if (!live) {
    assert.equal((await post('/mcp', { jsonrpc: '2.0', id: 2, method: 'ping' }, auth)).status, 503)
    socket = new WebSocket(origin.replace('http:', 'ws:') + '/bridge', ['katazuku-spark', 'auth.' + bridgeToken])
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
    socket.addEventListener('message', event => { const m = JSON.parse(event.data); socket.send(JSON.stringify({ id: m.id, result: { jsonrpc: '2.0', id: JSON.parse(m.body).id, result: { synthetic: true } } })) })
    const response = await (await post('/mcp', { jsonrpc: '2.0', id: 3, method: 'ping' }, auth)).json()
    assert.equal(response.result.synthetic, true)
  } else {
    const response = await (await post('/mcp', { jsonrpc: '2.0', id: 3, method: 'tools/list' }, auth)).json()
    assert.deepEqual(response.result.tools.map(t => t.name), ['spark_enqueue', 'spark_status', 'spark_list'])
    const requestKey = 'spark-gateway-smoke-' + Date.now()
    const call = { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'spark_enqueue', arguments: { requestKey, kind: 'document', input: '合成テストです。個人情報を使わず「Spark接続テスト成功」という短い文書を作成してください。外部サイトの操作は不要です。' } } }
    const result = await (await post('/mcp', call, auth)).json()
    assert.equal(result.result.isError, false)
    const run = JSON.parse(result.result.content[0].text)
    const duplicate = await (await post('/mcp', call, auth)).json()
    assert.equal(JSON.parse(duplicate.result.content[0].text).runId, run.runId)
    writeFileSync('smoke.local.json', JSON.stringify({ requestKey, runId: run.runId }))
  }
  assert.equal((await req('/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(tokenBody) })).status, 400)
  console.log('PASS OAuth発見・認証必須・CSRF・同意とコードの再利用拒否・表示escape・操作制限・中継' + (live ? '・MiniPC実機・依頼冪等性' : '・MiniPC切断'))
} finally {
  socket?.close()
  if (child) {
    if (process.platform === 'win32') await new Promise(resolve => spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('exit', resolve))
    else child.kill('SIGTERM')
    rmSync('test.local.json', { force: true })
  }
}
