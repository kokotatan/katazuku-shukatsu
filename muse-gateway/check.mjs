import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const origin = 'http://127.0.0.1:18802'
const ownerKey = randomBytes(32).toString('base64url')
const bridgeToken = randomBytes(32).toString('base64url')
const digest = (value) => createHash('sha256').update(value).digest('base64url')
const request = (path, options = {}) => fetch(origin + path, { ...options, redirect: 'manual' })
const post = (path, value, headers = {}) => request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) })
let child
let socket
try {
  const config = JSON.parse(readFileSync('wrangler.example.jsonc', 'utf8'))
  config.vars = { PUBLIC_ORIGIN: origin, OWNER_KEY_SHA256: createHash('sha256').update(ownerKey).digest('hex'), BRIDGE_TOKEN: bridgeToken }
  delete config.secrets
  config.kv_namespaces[0].id = '0'.repeat(32)
  writeFileSync('test.local.json', JSON.stringify(config))
  child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--config', 'test.local.json', '--port', '18802', '--ip', '127.0.0.1'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let ready = false
  for (let index = 0; index < 60; index++) {
    try { if ((await request('/health')).ok) { ready = true; break } } catch {}
    await delay(500)
  }
  assert(ready, 'gatewayが起動しませんでした')
  assert.equal((await post('/mcp', {})).status, 401)
  assert.equal((await request('/bridge')).status, 401)
  assert.equal((await post('/mcp', {}, { Origin: 'https://attacker.example' })).status, 403)
  const discovery = await (await request('/.well-known/oauth-authorization-server')).json()
  assert.equal(discovery.authorization_endpoint, origin + '/authorize')
  assert.deepEqual(discovery.scopes_supported, ['katazuku:read', 'katazuku:write', 'katazuku:sensitive', 'katazuku:actions'])

  const registration = await post('/oauth/register', {
    client_name: '<script>偽アプリ</script>', redirect_uris: ['https://client.example/callback'],
    token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
  })
  assert.equal(registration.status, 201)
  const client = await registration.json()
  const verifier = randomBytes(32).toString('base64url')
  const params = new URLSearchParams({
    client_id: client.client_id, redirect_uri: 'https://client.example/callback', response_type: 'code',
    resource: origin + '/mcp', scope: 'katazuku:read', state: 'synthetic-test',
    code_challenge: digest(verifier), code_challenge_method: 'S256',
  })
  const page = await request('/authorize?' + params)
  assert.equal(page.status, 200)
  assert.equal(page.headers.get('Referrer-Policy'), 'same-origin')
  const html = await page.text()
  assert(!html.includes('<script>偽アプリ'))
  assert(html.includes('katazuku:read') && !html.includes('katazuku:sensitive'))
  const handle = html.match(/name="handle" value="([^"]+)"/)[1]
  const cookie = page.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ')
  const submit = (key, cookies = cookie) => request('/authorize', {
    method: 'POST', headers: { Origin: origin, Cookie: cookies, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ handle, ownerKey: key, decision: 'approve', scope: 'katazuku:read' }),
  })
  assert.equal((await submit('wrong')).status, 401)
  const approved = await submit(ownerKey)
  assert.equal(approved.status, 303)
  assert.equal((await submit(ownerKey)).status, 400)
  const callback = new URL(approved.headers.get('location'))
  const tokenBody = {
    grant_type: 'authorization_code', client_id: client.client_id, redirect_uri: 'https://client.example/callback',
    code: callback.searchParams.get('code'), code_verifier: verifier, resource: origin + '/mcp',
  }
  const tokenResponse = await request('/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(tokenBody) })
  assert.equal(tokenResponse.status, 200)
  const token = await tokenResponse.json()
  const authorization = { Authorization: 'Bearer ' + token.access_token }
  const sensitive = await (await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'katazuku_snapshot', arguments: {} } }, authorization)).json()
  assert.equal(sensitive.error.code, -32601)
  assert.equal((await post('/mcp', { jsonrpc: '2.0', id: 2, method: 'ping' }, authorization)).status, 503)

  socket = new WebSocket(origin.replace('http:', 'ws:') + '/bridge', ['katazuku-muse', 'auth.' + bridgeToken])
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    assert.deepEqual(message.scopes, ['katazuku:read'])
    socket.send(JSON.stringify({ id: message.id, result: { jsonrpc: '2.0', id: JSON.parse(message.body).id, result: { synthetic: true } } }))
  })
  const response = await (await post('/mcp', { jsonrpc: '2.0', id: 3, method: 'ping' }, authorization)).json()
  assert.equal(response.result.synthetic, true)
  assert.equal((await request('/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(tokenBody) })).status, 400)
  console.log('Muse gateway: OAuth discovery・PKCE・CSRF・scope・中継・code再利用拒否を確認')
} finally {
  socket?.close()
  if (child) {
    if (process.platform === 'win32') await new Promise((resolve) => spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('exit', resolve))
    else child.kill('SIGTERM')
  }
  rmSync('test.local.json', { force: true })
}
