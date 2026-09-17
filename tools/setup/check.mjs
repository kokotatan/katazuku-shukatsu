import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { startSetup } from './server.mjs'

const root = await mkdtemp(join(tmpdir(), 'katazuku-setup-test-'))
let app
const secret = randomBytes(32).toString('base64url')
const grant = randomBytes(32).toString('base64url')
try {
  await writeFile(join(root, 'package.json'), '{"private":false}')
  await writeFile(join(root, '.env'), `KATAZUKU_APP_ORIGIN=https://app.example.com\nKATAZUKU_WRITE_SECRET=${secret}\n`)
  app = await startSetup({ root, port: 0, fetcher: async (url, options) => {
    assert.equal(url, 'https://app.example.com/api/auth/setup-link')
    assert.equal(options.headers.Authorization, 'Bearer ' + secret)
    assert.equal(options.redirect, 'error')
    return Response.json({ setupToken: grant })
  } })
  const state = await (await fetch(app.url + '/api/status')).json()
  assert.equal(state.cloudReady, true); assert.ok(!JSON.stringify(state).includes(secret))
  const wrongHost = await new Promise((resolve, reject) => { const request = httpRequest(app.url, { headers: { Host: 'evil.example.com' } }, response => { response.resume(); resolve(response.statusCode) }); request.once('error', reject); request.end() })
  assert.equal(wrongHost, 403)
  const post = (input, headers = {}) => fetch(app.url + '/api/password', { method: 'POST', headers: { origin: app.url, 'content-type': 'application/json', 'x-katazuku-csrf': state.csrf, ...headers }, body: JSON.stringify(input) })
  assert.equal((await post({ deviceName: 'テスト用PC' }, { origin: 'https://other.example.com' })).status, 403)
  assert.equal((await post({ deviceName: 'テスト用PC' }, { 'x-katazuku-csrf': 'wrong' })).status, 403)
  const response = await post({ deviceName: 'テスト用PC' }); assert.equal(response.status, 200)
  assert.equal((await response.json()).url, 'https://app.example.com/setup/#setup=' + grant)
  assert.equal((await post({ deviceName: 'x'.repeat(5000) })).status, 400)
  assert.equal((await fetch(app.url + '/.env')).status, 403)
  assert.equal((await fetch(app.url + '/api/status?secret=test')).status, 400)
  console.log('PC設定: 秘密を出さない・Host/Origin/CSRF・固定接続先・入力上限を確認')
} finally {
  await app?.close()
  assert.equal(dirname(resolve(root)), resolve(tmpdir())); assert.ok(root.includes('katazuku-setup-test-'))
  await rm(root, { recursive: true, force: true })
}
