import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const here = dirname(fileURLToPath(import.meta.url))
const repository = resolve(process.env.KATAZUKU_MUSE_E2E_REPOSITORY || join(here, '..'))
const origin = 'http://127.0.0.1:18803'
const ownerKey = randomBytes(32).toString('base64url')
const bridgeToken = randomBytes(32).toString('base64url')
const digest = (value) => createHash('sha256').update(value).digest('base64url')
const request = (path, options = {}) => fetch(origin + path, { ...options, redirect: 'manual' })
const post = (path, value, headers = {}) => request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) })
const root = mkdtempSync(join(tmpdir(), 'katazuku-muse-e2e-'))
const dbPath = join(root, 'katazuku.db')
const workflowStorePath = join(root, 'workflow.db')
// Wrangler resolves the entrypoint relative to the config file, so the test config belongs beside worker.ts.
const gatewayConfigPath = join(here, 'test-e2e.local.json')
const bridgeConfigPath = join(root, 'bridge.local.json')
const tsxCli = resolve(process.env.KATAZUKU_MUSE_E2E_TSX_CLI || join(repository, 'node_modules', 'tsx', 'dist', 'cli.mjs'))
const bridgeScript = resolve(process.env.KATAZUKU_MUSE_E2E_BRIDGE_SCRIPT || join(repository, 'scripts', 'muse-bridge.ts'))
const seedScript = resolve(process.env.KATAZUKU_MUSE_E2E_SEED_SCRIPT || join(repository, 'examples', 'seed.ts'))
const expectedCompany = process.env.KATAZUKU_MUSE_E2E_EXPECTED_COMPANY || 'Example Inc.'
const expectedServerName = process.env.KATAZUKU_MUSE_E2E_EXPECTED_SERVER_NAME || 'katazuku-shukatsu'
const resultLabel = process.env.KATAZUKU_MUSE_E2E_LABEL || 'Muse E2E'
let gateway
let bridge

async function stop(child) {
  if (!child || child.exitCode != null) return
  if (process.platform === 'win32') {
    await new Promise((resolve) => spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('exit', resolve))
  } else {
    child.kill('SIGTERM')
    await new Promise((resolve) => child.once('exit', resolve))
  }
}

try {
  const seeded = spawnSync(process.execPath, [tsxCli, seedScript, dbPath], {
    cwd: repository, encoding: 'utf8', windowsHide: true,
  })
  assert.equal(seeded.status, 0, '合成DBを作成できませんでした')

  const gatewayConfig = JSON.parse(readFileSync(join(here, 'wrangler.example.jsonc'), 'utf8'))
  gatewayConfig.vars = {
    PUBLIC_ORIGIN: origin,
    OWNER_KEY_SHA256: createHash('sha256').update(ownerKey).digest('hex'),
    BRIDGE_TOKEN: bridgeToken,
  }
  delete gatewayConfig.secrets
  gatewayConfig.kv_namespaces[0].id = '0'.repeat(32)
  writeFileSync(gatewayConfigPath, JSON.stringify(gatewayConfig))
  writeFileSync(bridgeConfigPath, JSON.stringify({
    origin, token: bridgeToken,
    scopes: ['katazuku:read', 'katazuku:write', 'katazuku:sensitive', 'katazuku:actions'],
    dbPath, workflowStorePath,
  }))

  const refused = spawnSync(process.execPath, [tsxCli, bridgeScript], {
    cwd: repository, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, KATAZUKU_MUSE_BRIDGE_CONFIG: bridgeConfigPath }, timeout: 10_000,
  })
  assert.notEqual(refused.status, 0, '明示したloopback試験以外でHTTP gatewayを許可してはいけません')

  gateway = spawn(process.execPath, [join(here, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), 'dev', '--local', '--config', gatewayConfigPath, '--port', '18803', '--ip', '127.0.0.1'], {
    cwd: here, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  })
  let ready = false
  for (let index = 0; index < 60; index++) {
    try { if ((await request('/health')).ok) { ready = true; break } } catch {}
    await delay(500)
  }
  assert(ready, 'gatewayが起動しませんでした')

  const registration = await post('/oauth/register', {
    client_name: 'Muse E2E synthetic client', redirect_uris: ['https://client.example/callback'],
    token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
  })
  assert.equal(registration.status, 201)
  const client = await registration.json()
  const verifier = randomBytes(32).toString('base64url')
  const allScopes = ['katazuku:read', 'katazuku:write', 'katazuku:sensitive', 'katazuku:actions']
  const params = new URLSearchParams({
    client_id: client.client_id, redirect_uri: 'https://client.example/callback', response_type: 'code',
    resource: origin + '/mcp', scope: allScopes.join(' '), state: 'e2e-synthetic',
    code_challenge: digest(verifier), code_challenge_method: 'S256',
  })
  const page = await request('/authorize?' + params)
  assert.equal(page.status, 200)
  const html = await page.text()
  for (const scope of allScopes) assert(html.includes(scope))
  const handle = html.match(/name="handle" value="([^"]+)"/)?.[1]
  assert(handle)
  const cookie = page.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ')
  const form = new URLSearchParams({ handle, ownerKey, decision: 'approve' })
  for (const scope of allScopes) form.append('scope', scope)
  const approved = await request('/authorize', {
    method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form,
  })
  assert.equal(approved.status, 303)
  const callback = new URL(approved.headers.get('location'))
  const tokenResponse = await request('/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', client_id: client.client_id, redirect_uri: 'https://client.example/callback',
      code: callback.searchParams.get('code'), code_verifier: verifier, resource: origin + '/mcp',
    }),
  })
  assert.equal(tokenResponse.status, 200)
  const token = await tokenResponse.json()
  const authorization = { Authorization: 'Bearer ' + token.access_token, 'MCP-Protocol-Version': '2025-06-18' }

  bridge = spawn(process.execPath, [tsxCli, bridgeScript], {
    cwd: repository, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    env: {
      ...process.env,
      KATAZUKU_MUSE_BRIDGE_CONFIG: bridgeConfigPath,
      KATAZUKU_MUSE_BRIDGE_TEST_LOOPBACK: '1',
    },
  })
  const rpc = async (id, method, params) => {
    const response = await post('/mcp', { jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }, authorization)
    assert.equal(response.status, 200)
    return response.json()
  }
  let connected = false
  for (let index = 0; index < 60; index++) {
    const response = await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'ping' }, authorization)
    if (response.status === 200) { connected = true; break }
    await delay(250)
  }
  assert(connected, '実bridgeがgatewayへ接続しませんでした')

  const initialized = await rpc(2, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'muse-e2e', version: '1' } })
  assert.equal(initialized.result.serverInfo.name, expectedServerName)
  const listed = await rpc(3, 'tools/list', {})
  const names = listed.result.tools.map((tool) => tool.name)
  for (const name of ['katazuku_today', 'katazuku_snapshot', 'katazuku_record_mail', 'katazuku_prepare_action']) assert(names.includes(name))
  assert(!names.includes('shell'))

  const status = await rpc(4, 'tools/call', { name: 'katazuku_status', arguments: { company: expectedCompany } })
  assert.equal(status.result.isError, false)
  assert(status.result.content[0].text.includes(expectedCompany))
  const snapshot = await rpc(5, 'tools/call', { name: 'katazuku_snapshot', arguments: {} })
  assert.equal(snapshot.result.isError, false)
  const snapshotData = JSON.parse(snapshot.result.content[0].text)
  assert(snapshotData && typeof snapshotData === 'object' && !Array.isArray(snapshotData))

  const recorded = await rpc(6, 'tools/call', { name: 'katazuku_record_mail', arguments: { items: [{
    id: 'muse-e2e-message', receivedAt: '2099-01-01T00:00:00Z', subject: 'Synthetic appointment request',
    summary: 'Synthetic E2E only', needsAction: true, company: expectedCompany, sourceRef: 'muse-email:synthetic:muse-e2e-message',
  }] } })
  assert.equal(recorded.result.isError, false)
  const queue = await rpc(7, 'tools/call', { name: 'katazuku_work_queue', arguments: {} })
  assert(JSON.parse(queue.result.content[0].text).mail.some((item) => item.id === 'muse-e2e-message'))

  const action = {
    actionType: 'email.send', target: { to: ['recipient@example.com'] },
    content: { subject: 'Synthetic reply', body: 'Synthetic body' },
    effectiveAt: 'immediate', notification: 'Synthetic recipient receives a message',
  }
  const prepared = await rpc(8, 'tools/call', { name: 'katazuku_prepare_action', arguments: {
    runId: 'muse-e2e-action', sourceRef: 'muse-email:synthetic:muse-e2e-message', action,
  } })
  const preparedData = JSON.parse(prepared.result.content[0].text)
  assert.equal(prepared.result.isError, false)
  assert.equal(preparedData.run.status, 'needs_user')
  assert.equal(preparedData.approval.status, 'requested')

  const forbidden = await post('/mcp', { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'shell', arguments: {} } }, authorization)
  assert.equal((await forbidden.json()).error.code, -32601)
  console.log(`${resultLabel}: OAuth全4scope → gateway → 実bridge → 合成DBのread/sensitive/write/actions往復を確認`)
} finally {
  await stop(bridge)
  await stop(gateway)
  rmSync(gatewayConfigPath, { force: true })
  rmSync(root, { recursive: true, force: true })
}
