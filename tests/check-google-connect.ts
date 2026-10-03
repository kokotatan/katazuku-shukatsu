/** 合成OAuth応答と自分専用のloopbackだけを使用。Google通信・実認証・実資格情報は使わない。 */
import { strict as assert } from 'node:assert'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request as httpRequest } from 'node:http'
import { checkStoredGoogleReadConnection, connectGoogleReadOnly, GoogleConnectError, GOOGLE_ISSUER, GOOGLE_READ_SCOPES, GOOGLE_READ_SUCCESS, GOOGLE_TOKEN_ENDPOINT, GOOGLE_USERINFO_ENDPOINT, protectGoogleSecretFile, saveGoogleCredential, type GoogleConnectOptions } from '../src/google-connect.js'

const sandbox = mkdtempSync(join(tmpdir(), 'katazuku-google-fake-'))
const home = join(sandbox, 'home')
const root = join(sandbox, 'repo')
mkdirSync(home); mkdirSync(root)
const email = 'you@example.test'
const clientId = 'synthetic-client.apps.googleusercontent.com'
let count = 0
let testId = 0
const check = (label: string, condition = true) => { assert(condition, label); count++; console.log('[ok] ' + label) }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const goodToken = () => ({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', token_type: 'Bearer', expires_in: 3600, scope: GOOGLE_READ_SCOPES.join(' ') })
type Run = ReturnType<typeof scenario>
function scenario(): { options: GoogleConnectOptions; path: string; calls: string[]; authorization?: URL; exchange?: URLSearchParams } {
  const directory = join(home, 'credentials-' + ++testId)
  const run: Run = { options: { email, credentialsDir: directory, root, home, clientId, clientSecret: 'synthetic-secret',
    // 合成ファイルのみ。Windows ACLの実装は別に固定引数で検証する。
    protectFile: path => chmodSync(path, 0o600), timeoutMs: 2000 }, path: join(directory, email + '.json'), calls: [] }
  run.options.openBrowser = async value => {
    run.authorization = new URL(value)
    assert.equal(run.authorization.origin, GOOGLE_ISSUER)
    const callback = new URL(run.authorization.searchParams.get('redirect_uri')!)
    assert.equal(callback.hostname, '127.0.0.1')
    callback.searchParams.set('state', run.authorization.searchParams.get('state')!)
    callback.searchParams.set('code', 'synthetic-code')
    const response = await fetch(callback)
    assert.equal(response.status, 200)
    const text = await response.text()
    assert(!text.includes('synthetic-code') && !text.includes(email))
  }
  run.options.fetch = async (input, init) => {
    const url = String(input)
    run.calls.push(url)
    assert.equal(init?.redirect, 'error')
    assert(init?.signal)
    if (url === GOOGLE_TOKEN_ENDPOINT) {
      run.exchange = new URLSearchParams(String(init?.body))
      assert.equal(init?.method, 'POST')
      assert.equal(run.exchange.get('grant_type'), 'authorization_code')
      assert.equal(run.exchange.get('redirect_uri'), run.authorization?.searchParams.get('redirect_uri'))
      const verifier = run.exchange.get('code_verifier')!
      assert(/^[A-Za-z0-9_-]{43,128}$/.test(verifier))
      assert.equal(createHash('sha256').update(verifier).digest('base64url'), run.authorization?.searchParams.get('code_challenge'))
      assert.equal(run.authorization?.searchParams.get('code_challenge_method'), 'S256')
      return json(goodToken())
    }
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer synthetic-access')
    if (url === GOOGLE_USERINFO_ENDPOINT) return json({ sub: 'synthetic-subject', email, email_verified: true })
    if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/profile') return json({ emailAddress: email })
    if (url === 'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1') return json({ kind: 'calendar#calendarList' })
    throw new Error('Unexpected endpoint')
  }
  return run
}
async function rejected(label: string, run: Run): Promise<void> {
  await assert.rejects(connectGoogleReadOnly(run.options), error => {
    assert(error instanceof GoogleConnectError)
    assert(!error.message.includes(email) && !error.message.includes(home) && !error.message.includes('synthetic-secret'))
    return true
  })
  check(label, !existsSync(run.path))
  if (existsSync(run.options.credentialsDir)) assert(!readdirSync(run.options.credentialsDir).some(name => name.endsWith('.tmp')))
}
function changeCallback(run: Run, mutate: (callback: URL, authorization: URL) => void, status = 400): void {
  run.options.openBrowser = async value => {
    const authorization = new URL(value)
    const callback = new URL(authorization.searchParams.get('redirect_uri')!)
    callback.search = new URLSearchParams({ state: authorization.searchParams.get('state')!, code: 'synthetic-code' }).toString()
    mutate(callback, authorization)
    const response = await fetch(callback)
    assert.equal(response.status, status)
    const body = await response.text()
    assert(!body.includes('synthetic-code') && !body.includes(email))
  }
}
function replaceResponse(run: Run, endpoint: string, body: unknown, status = 200): void {
  const previous = run.options.fetch!
  run.options.fetch = async (input, init) => String(input) === endpoint ? json(body, status) : previous(input, init)
}

try {
  let run = scenario()
  await connectGoogleReadOnly(run.options)
  const stored = JSON.parse(readFileSync(run.path, 'utf8'))
  check('固定Google接続先、loopback、S256 PKCEで接続し互換JSONを保存する', stored.refresh_token === 'synthetic-refresh' && stored.token_uri === GOOGLE_TOKEN_ENDPOINT)
  check('要求権限は本人確認とGmail/Calendar読取りだけ', run.authorization?.searchParams.get('scope') === GOOGLE_READ_SCOPES.join(' ') && !run.authorization?.searchParams.has('include_granted_scopes'))
  check('内容・件数・メール本文・予定の取得を診断に使わない', run.calls.length === 4 && !run.calls.some(url => /messages|events/.test(url)))
  check('一時ファイルを残さず読取り専用を明示する', readdirSync(run.options.credentialsDir).length === 1 && stored.katazuku_connection === 'read-only' && GOOGLE_READ_SUCCESS.includes('別のMCP接続'))
  if (process.platform !== 'win32') check('POSIXの資格情報は0600', (statSync(run.path).mode & 0o777) === 0o600)
  const original = readFileSync(run.path, 'utf8')
  let opened = false
  run.options.openBrowser = async () => { opened = true }
  await assert.rejects(connectGoogleReadOnly(run.options), GoogleConnectError)
  check('既存MCP資格情報があればブラウザ・通信より先に拒否する', !opened && readFileSync(run.path, 'utf8') === original && run.calls.length === 4)
  await checkStoredGoogleReadConnection(email, run.options.credentialsDir, async (input, init) => {
    if (String(input) === GOOGLE_TOKEN_ENDPOINT) {
      assert.equal(new URLSearchParams(String(init?.body)).get('grant_type'), 'refresh_token')
      assert.equal(init?.redirect, 'error')
      return json({ access_token: 'synthetic-access' })
    }
    return run.options.fetch!(input, init)
  }, {})
  check('公開getGoogleAccessTokenで再利用し、確認しても既存ファイルは不変', readFileSync(run.path, 'utf8') === original)

  run = scenario()
  changeCallback(run, callback => callback.searchParams.set('state', 'wrong-state'))
  await rejected('state不一致は交換も保存もしない', run)
  check('不正callbackではGoogleへの通信なし', run.calls.length === 0)
  run = scenario()
  changeCallback(run, callback => callback.searchParams.set('state', 'あ'.repeat(43)))
  await rejected('マルチバイトの不正stateも例外を漏らさず拒否する', run)
  run = scenario()
  changeCallback(run, callback => callback.searchParams.append('state', 'second-state'))
  await rejected('重複したOAuthパラメータを拒否する', run)
  run = scenario()
  changeCallback(run, callback => callback.searchParams.set('iss', 'https://issuer.example.com'))
  await rejected('Google以外のissuerを拒否する', run)
  run = scenario()
  changeCallback(run, callback => { callback.searchParams.delete('code'); callback.searchParams.set('error', 'access_denied') })
  await rejected('Googleで本人が許可を拒否すると保存しない', run)
  run = scenario()
  changeCallback(run, callback => callback.searchParams.delete('code'))
  await rejected('認証codeがない応答を拒否する', run)
  run = scenario()
  run.options.timeoutMs = 30
  let timeoutUrl: URL | undefined
  run.options.openBrowser = async value => { timeoutUrl = new URL(new URL(value).searchParams.get('redirect_uri')!) }
  await rejected('認証待ちの時間切れで保存しない', run)
  await assert.rejects(fetch(timeoutUrl!))
  check('時間切れ後はloopback受付も閉じる')
  run = scenario()
  const controller = new AbortController()
  run.options.signal = controller.signal
  run.options.openBrowser = async () => { controller.abort() }
  await rejected('本人のキャンセルで受付を閉じる', run)
  run = scenario()
  run.options.openBrowser = async () => { throw new Error('synthetic-secret ' + email) }
  await rejected('ブラウザ起動失敗の例外から個人値を出さない', run)
  run = scenario()
  run.options.openBrowser = async value => {
    const authorization = new URL(value)
    const callback = new URL(authorization.searchParams.get('redirect_uri')!)
    const wrongPath = new URL('/favicon.ico', callback)
    assert.equal((await fetch(wrongPath)).status, 404)
    assert.equal((await fetch(callback, { method: 'POST' })).status, 404)
    const wrongHost = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(callback, { headers: { Host: 'attacker.example.com' } }, response => { response.resume(); resolve(response.statusCode) })
      request.once('error', reject); request.end()
    })
    assert.equal(wrongHost, 404)
    run.authorization = authorization
    callback.search = new URLSearchParams({ state: authorization.searchParams.get('state')!, code: 'synthetic-code', iss: GOOGLE_ISSUER }).toString()
    assert.equal((await fetch(callback)).status, 200)
  }
  await connectGoogleReadOnly(run.options)
  check('異なるpath/method/Hostは受付せず正しいcallbackだけ交換する', run.calls.length === 4)

  for (const [label, token] of [
    ['refresh_tokenなし', { ...goodToken(), refresh_token: undefined }],
    ['access_tokenなし', { ...goodToken(), access_token: undefined }],
    ['権限不足', { ...goodToken(), scope: 'openid email' }],
    ['書込み権限混入', { ...goodToken(), scope: GOOGLE_READ_SCOPES.join(' ') + ' https://www.googleapis.com/auth/gmail.modify' }],
    ['不正なtoken_type', { ...goodToken(), token_type: 'Basic' }],
    ['不正な有効期限', { ...goodToken(), expires_in: '3600' }],
    ['配列応答', []],
  ] as const) {
    run = scenario(); replaceResponse(run, GOOGLE_TOKEN_ENDPOINT, token)
    await rejected(label + 'では資格情報を保存しない', run)
  }
  run = scenario()
  replaceResponse(run, GOOGLE_TOKEN_ENDPOINT, { ...goodToken(), scope: GOOGLE_READ_SCOPES.join(' ').replace(' email ', ' https://www.googleapis.com/auth/userinfo.email ') })
  await connectGoogleReadOnly(run.options)
  check('Googleの正規化されたemail scopeも受理する')
  for (const [label, user] of [
    ['別アカウント', { sub: 'synthetic-subject', email: 'other@example.com', email_verified: true }],
    ['未確認メール', { sub: 'synthetic-subject', email, email_verified: false }],
    ['文字列のverifiedフラグ', { sub: 'synthetic-subject', email, email_verified: 'true' }],
    ['subjectなし', { email, email_verified: true }],
  ] as const) {
    run = scenario(); replaceResponse(run, GOOGLE_USERINFO_ENDPOINT, user)
    await rejected(label + 'をUserInfoで拒否する', run)
  }
  run = scenario(); replaceResponse(run, 'https://gmail.googleapis.com/gmail/v1/users/me/profile', { emailAddress: 'other@example.com' })
  await rejected('Gmailのアカウント不一致も拒否する', run)
  run = scenario(); replaceResponse(run, 'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1', {})
  await rejected('Calendarの不正応答を拒否する', run)
  for (const status of [302, 403, 500]) {
    run = scenario(); replaceResponse(run, GOOGLE_TOKEN_ENDPOINT, { error: 'synthetic-secret ' + email }, status)
    await rejected('HTTP ' + status + ' の失敗を秘密なしで説明する', run)
  }
  run = scenario(); run.options.fetch = async () => new Response('broken synthetic-secret ' + email)
  await rejected('不正JSONのエラー本文を出さない', run)
  run = scenario(); run.options.fetch = async () => { throw new Error('synthetic-secret ' + email) }
  await rejected('通信例外の秘密を出さない', run)
  run = scenario(); run.options.timeoutMs = 40
  run.options.fetch = async (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('timeout synthetic-secret')), { once: true }))
  await rejected('交換中の時間切れでも保存しない', run)

  run = scenario(); run.options.credentialsDir = root
  await rejected('リポジトリを保存先にできない', run)
  run = scenario(); run.options.credentialsDir = join(sandbox, 'outside')
  await rejected('本人のホーム外を保存先にできない', run)
  run = scenario(); run.options.email = '../you@example.test'
  await rejected('アカウントで保存パスを脱出できない', run)
  run = scenario(); run.options.clientSecret = ''
  await rejected('クライアント未設定ではブラウザを開かない', run)
  run = scenario(); run.options.protectFile = () => { throw new Error('ACL failure') }
  await rejected('保存ACLを設定できなければ秘密を残さない', run)
  run = scenario()
  const previous = run.options.fetch!
  run.options.fetch = async (input, init) => {
    const response = await previous(input, init)
    if (String(input).includes('calendarList')) writeFileSync(run.path, 'existing-mcp-synthetic')
    return response
  }
  await assert.rejects(connectGoogleReadOnly(run.options), GoogleConnectError)
  check('認証中に既存ファイルができてもatomic保存は上書きしない', readFileSync(run.path, 'utf8') === 'existing-mcp-synthetic' && readdirSync(run.options.credentialsDir).length === 1)
  run = scenario()
  const link = join(home, 'outside-link')
  symlinkSync(root, link, process.platform === 'win32' ? 'junction' : 'dir')
  run.options.credentialsDir = join(link, 'secrets')
  await rejected('保存先のリンクがrepoを指す場合は作成前に拒否する', run)
  check('拒否したリンク先にディレクトリを作らない', !existsSync(join(root, 'secrets')))

  const commands: { command: string; args: readonly string[] }[] = []
  protectGoogleSecretFile('synthetic-empty-file', 'win32', ((command: string, args: readonly string[]) => {
    commands.push({ command, args }); return command === 'whoami.exe' ? '"synthetic-user","S-1-5-21-100-200-300-400"' : ''
  }) as typeof import('node:child_process').execFileSync)
  check('Windowsの新規ファイルだけに本人SIDの非継承ACLを設定する', commands.length === 2 && commands[1].command === 'icacls.exe'
    && commands[1].args.join(' ') === 'synthetic-empty-file /inheritance:r /grant:r *S-1-5-21-100-200-300-400:(F)')
  assert.throws(() => protectGoogleSecretFile('synthetic-empty-file', 'win32', (() => '') as unknown as typeof import('node:child_process').execFileSync), GoogleConnectError)
  check('Windowsの本人SIDが取れなければ保存権限設定を拒否する')

  const badDirectory = join(home, 'bad-endpoint'); mkdirSync(badDirectory)
  const badFile = join(badDirectory, email + '.json')
  writeFileSync(badFile, JSON.stringify({ refresh_token: 'synthetic-refresh', token_uri: 'https://token.example.com' }))
  let requested = false
  await assert.rejects(checkStoredGoogleReadConnection(email, badDirectory, async () => { requested = true; return json({}) }, {}), GoogleConnectError)
  check('保存された任意のtoken_uriに秘密を送らない', !requested)
  const exclusiveFile = join(home, 'exclusive.json'); writeFileSync(exclusiveFile, 'existing')
  assert.throws(() => saveGoogleCredential(exclusiveFile, { refresh_token: 'synthetic-refresh' }, path => chmodSync(path, 0o600)))
  check('保存関数を直接使っても既存ファイルを置換しない', readFileSync(exclusiveFile, 'utf8') === 'existing')
  console.log(`Google接続: ${count} checks OK（実認証は未実行）`)
} finally { rmSync(sandbox, { recursive: true, force: true }) }
