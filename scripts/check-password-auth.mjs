import assert from 'node:assert/strict'
import { randomBytes, pbkdf2Sync } from 'node:crypto'
import { build } from 'esbuild'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { existsSync } from 'node:fs'

const bundled = await build({ stdin: { contents: `import {passwordAuth,passwordSession} from './cloudflare/password-auth.ts'; export default {async fetch(request,env){return await passwordAuth(request,env) || Response.json({allowed:await passwordSession(request,env)})}}`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'neutral', external: ['node:*'] })
const readKey = randomBytes(32).toString('base64url'), writeKey = randomBytes(32).toString('base64url')
const origin = 'https://app.example.com'
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundled.outputFiles[0].text, compatibilityDate: '2026-08-29', compatibilityFlags: ['nodejs_compat'], r2Buckets: ['PRIVATE_DATA'], bindings: { KATAZUKU_READ_SECRET: readKey, KATAZUKU_WRITE_SECRET: writeKey }, ratelimits: { AUTH_LIMIT: { namespace_id: '2001', simple: { limit: 100, period: 60 } } } }))
const request = (path, options = {}) => mf.dispatchFetch(origin + path, options)
const rawPost = (path, body, headers = {}) => request('/api/auth/' + path, { method: 'POST', headers: { origin, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
const post = async (path, body, headers = {}) => {
  if (typeof body.password === 'string' && body.password.length >= 15 && body.password.length <= 256) {
    const response = path === 'setup' ? await rawPost('inspect-setup', { setupToken: body.setupToken }) : await request('/api/auth/challenge')
    if (!response.ok) return response
    const challenge = await response.json()
    const { password, ...rest } = body
    body = { ...rest, passwordProof: pbkdf2Sync(password, challenge.salt, 600_000, 32, 'sha256').toString('hex') }
  }
  return rawPost(path, body, headers)
}
const setupLink = async () => {
  const response = await post('setup-link', { deviceName: 'テスト専用PC' }, { authorization: `Bearer ${writeKey}` })
  assert.equal(response.status, 200); return (await response.json()).setupToken
}
const password = 'synthetic-only-passphrase-001'
const proofModule = await build({ entryPoints: [existsSync('src/password-proof.ts') ? 'src/password-proof.ts' : 'shared/src/password-proof.ts'], write: false, format: 'esm' })
const { derivePasswordProof } = await import('data:text/javascript;base64,' + Buffer.from(proofModule.outputFiles[0].text).toString('base64'))
const cookie = response => response.headers.get('set-cookie')?.split(';')[0]
let passed = 0
async function check(name, run) { await run(); console.log(`PASS ${++passed}: ${name}`) }
try {
  await check('ブラウザーの導出が標準PBKDF2と一致し、不正な方式を受け付けない', async () => {
    const salt = randomBytes(16).toString('hex')
    assert.equal(await derivePasswordProof(password, { salt, scheme: 'pbkdf2-sha256-600000-v1' }), pbkdf2Sync(password, salt, 600_000, 32, 'sha256').toString('hex'))
    await assert.rejects(derivePasswordProof(password, { salt, scheme: 'weak-hash' }))
  })
  await check('第三者は初期登録も設定URLの発行もできない', async () => {
    assert.equal((await post('setup-link', { deviceName: '不正なPC' })).status, 401)
    assert.equal((await post('setup', { setupToken: randomBytes(32).toString('base64url'), password })).status, 401)
    assert.deepEqual(await (await request('/api/auth/status')).json(), { configured: false, authenticated: false })
  })
  const grant = await setupLink()
  await check('異なるorigin・壊れたJSON・大きな入力を拒否する', async () => {
    assert.equal((await post('setup', { setupToken: grant, password }, { origin: 'https://other.example.com' })).status, 403)
    assert.equal((await post('setup', { setupToken: grant, password: 'a'.repeat(5000) })).status, 413)
    assert.equal((await post('setup', { setupToken: grant, password: 'short' })).status, 400)
    assert.equal((await request('/api/auth/setup', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{' })).status, 400)
  })
  let session
  await check('正しい登録を一度だけ受け付け、Cookieに保護属性を付ける', async () => {
    const results = await Promise.all([1, 2].map(() => post('setup', { setupToken: grant, password })))
    assert.equal(results.filter(r => r.status === 200).length, 1)
    assert.ok(results.every(r => [200, 401, 409].includes(r.status)))
    const response = results.find(r => r.status === 200)
    session = cookie(response)
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) assert.ok(response.headers.get('set-cookie').includes(flag))
    assert.equal((await post('setup', { setupToken: grant, password })).status, 401)
    assert.equal((await (await request('/viewer', { headers: { cookie: session } })).json()).allowed, true)
  })
  await check('平文パスワードと生のセッショントークンを保存しない', async () => {
    const bucket = await mf.getR2Bucket('PRIVATE_DATA')
    const config = await (await bucket.get('auth-v2/password.json')).text()
    assert.ok(!config.includes(password)); assert.equal(JSON.parse(config).hash.length, 64)
    const value = JSON.parse(config)
    assert.notEqual(value.hash, await derivePasswordProof(password, value), '通信上の値をそのまま保存しない')
    assert.equal((await rawPost('login', { passwordProof: value.hash })).status, 401, '保存された値をそのままログインに利用できない')
    assert.equal((await rawPost('login', { password })).status, 400, '平文パスワードのAPI送信を受け付けない')
    const objects = await bucket.list({ prefix: 'auth-v2/session/' })
    for (const object of objects.objects) { assert.ok(!object.key.includes(session.split('=')[1])); assert.ok(!(await (await bucket.get(object.key)).text()).includes(session.split('=')[1])) }
  })
  await check('ログインとログアウト、旧キーの失効を確認する', async () => {
    assert.equal((await post('login', { password: 'incorrect-password' })).status, 401)
    assert.equal((await post('migrate', { readKey })).status, 401)
    const login = await post('login', { password }); assert.equal(login.status, 200)
    const active = cookie(login)
    assert.equal((await post('logout', {}, { cookie: active })).status, 200)
    assert.equal((await (await request('/viewer', { headers: { cookie: active } })).json()).allowed, false)
  })
  await check('再設定で既存端末を失効させ、古い設定URLも拒否する', async () => {
    const first = await setupLink(), second = await setupLink()
    assert.equal((await post('setup', { setupToken: first, password: password + 'changed' })).status, 200)
    assert.equal((await (await request('/viewer', { headers: { cookie: session } })).json()).allowed, false)
    assert.equal((await post('setup', { setupToken: second, password })).status, 409)
    assert.equal((await post('login', { password })).status, 401)
    assert.equal((await post('login', { password: password + 'changed' })).status, 200)
  })
  await check('別ホストではセッションを使用できず、認証情報をURLで受け付けない', async () => {
    const login = await post('login', { password: password + 'changed' })
    assert.equal((await (await mf.dispatchFetch('https://other.example.com/viewer', { headers: { cookie: cookie(login) } })).json()).allowed, false)
    assert.equal((await request('/api/auth/status?key=do-not-accept')).status, 400)
  })
  console.log(`パスワード初回設定: ${passed}項目成功`)
} finally { await mf.dispose() }
