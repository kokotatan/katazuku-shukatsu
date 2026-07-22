import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer as createNetServer } from 'node:net'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { startFixtureServer } from './fixture-server.mjs'
import {
  analyzeDeterministically,
  analyzeWithLocalModel,
  navigateTarget,
  readPageSummary,
  readSafePageState,
  sanitizePageSummary,
  validateModelDecision
} from './lib.mjs'

const execFileAsync = promisify(execFile)
const here = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
let checks = 0

function ok(value, message) {
  assert.ok(value, message)
  checks += 1
}

async function freePort() {
  const server = createNetServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}

async function waitForChrome(debugPort) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`, { signal: AbortSignal.timeout(1000) })
      if (response.ok) return
    } catch {}
    await delay(100)
  }
  throw new Error('試験用Chromeが起動しませんでした')
}

async function waitForSummary(debugPort, origin, isReady = () => true) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const page = await readPageSummary(debugPort, origin)
      if (isReady(page.summary)) return page
    } catch {}
    await delay(100)
  }
  const targets = await fetch('http://127.0.0.1:' + debugPort + '/json/list').then((response) => response.json()).catch(() => [])
  throw new Error('ページ遷移を確認できません: ' + origin + '; targets=' + targets.map((target) => target.url).join(','))
}

async function runBroker({ debugPort, credentialPath, decision }) {
  const args = [
    join(here, 'broker.mjs'),
    '--portal', decision.portal_id,
    '--credential', credentialPath,
    '--debug-port', String(debugPort),
    '--username-element', String(decision.username_element),
    '--password-element', String(decision.password_element)
  ]
  if (decision.submit_control != null) args.push('--submit-control', String(decision.submit_control), '--submit')
  return execFileAsync(process.execPath, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
    maxBuffer: 1024 * 1024
  })
}

async function main() {
  const raw = {
    origin: 'https://example.test',
    title: '試験',
    fields: [{ type: 'email', value: 'secret-user', label: 'メール' }, { type: 'password', value: 'secret-password', label: 'パスワード' }],
    controls: [{ type: 'submit', label: 'ログイン' }],
    blockers: []
  }
  const sanitized = sanitizePageSummary(raw)
  ok(!JSON.stringify(sanitized).includes('secret-user'), 'DOM要約からID値を除去する')
  ok(!JSON.stringify(sanitized).includes('secret-password'), 'DOM要約からパスワード値を除去する')
  assert.throws(() => validateModelDecision({
    action: 'fill_credentials',
    portal_id: 'portal',
    username_element: 2,
    password_element: 1
  }, sanitized, 'portal'), /ID欄/)
  checks += 1
  const ambiguousFields = sanitizePageSummary({
    origin: 'https://example.test',
    title: '曖昧な試験',
    fields: [
      { type: 'email', autocomplete: 'username', label: 'ログインID' },
      { type: 'email', autocomplete: 'email', label: 'メールアドレス' },
      { type: 'password', label: 'パスワード' }
    ],
    controls: [{ type: 'submit', label: 'ログイン' }],
    blockers: []
  })
  assert.throws(() => validateModelDecision({
    action: 'fill_credentials',
    portal_id: 'portal',
    username_element: 1,
    password_element: 3,
    submit_control: 1
  }, ambiguousFields, 'portal'), /一意/)
  checks += 1
  const ambiguousControls = sanitizePageSummary({
    origin: 'https://example.test',
    title: '曖昧な試験',
    fields: [{ type: 'email', autocomplete: 'username' }, { type: 'password' }],
    controls: [{ type: 'submit', label: 'ログイン' }, { type: 'button', label: 'Login' }],
    blockers: []
  })
  assert.throws(() => validateModelDecision({
    action: 'fill_credentials',
    portal_id: 'portal',
    username_element: 1,
    password_element: 2,
    submit_control: 1
  }, ambiguousControls, 'portal'), /送信コントロール/)
  checks += 1

  await mkdir(join(repoRoot, 'logs'), { recursive: true })
  const tempDir = await mkdtemp(join(repoRoot, 'logs', 'local-login-check-'))
  const fixture = await startFixtureServer()
  const origin = `http://127.0.0.1:${fixture.port}`
  const otherOrigin = `http://localhost:${fixture.port}`
  const credentialPath = join(tempDir, 'fixture.dpapi.json')
  const debugPort = await freePort()
  let chrome

  try {
    const store = await execFileAsync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(here, 'store-credential.ps1'),
      '-PortalId', 'fixture_portal',
      '-AllowedOrigin', origin,
      '-OutputPath', credentialPath,
      '-Fixture'
    ], { encoding: 'utf8', windowsHide: true, timeout: 30000 })
    ok(JSON.parse(store.stdout.trim()).status === 'stored', '合成資格情報をDPAPIで保存する')
    const encryptedRecord = (await readFile(credentialPath, 'utf8')).replace(/^\uFEFF/, '')
    ok(!encryptedRecord.includes('fixture-user@example.test'), '暗号化ファイルにID平文を残さない')
    ok(!encryptedRecord.includes('fixture-password-42'), '暗号化ファイルにパスワード平文を残さない')

    chrome = spawn(chromePath, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-sync',
      '--no-first-run',
      `--remote-debugging-port=${debugPort}`,
      '--remote-allow-origins=*',
      `--user-data-dir=${join(tempDir, 'chrome-profile')}`,
      `${origin}/login`
    ], { windowsHide: true, stdio: 'ignore' })
    await waitForChrome(debugPort)

    const loginPage = await waitForSummary(debugPort, origin, (summary) => summary.fields.length === 3 && summary.controls.length === 1)
    ok(loginPage.summary.fields.length === 3, '検索欄を含むログインDOMを列挙する')
    ok(!JSON.stringify(loginPage.summary).includes('fixture-password-42'), 'モデル入力に資格情報を含めない')

    const decision = process.env.LOCAL_LOGIN_MODEL_URL
      ? await analyzeWithLocalModel(loginPage.summary, 'fixture_portal', { baseUrl: process.env.LOCAL_LOGIN_MODEL_URL })
      : analyzeDeterministically(loginPage.summary, 'fixture_portal')
    const checked = validateModelDecision(decision, loginPage.summary, 'fixture_portal')
    ok(checked.username_element === 2 && checked.password_element === 3, '検索欄と資格情報欄を区別する')
    ok(checked.submit_control === 1, 'ログイン送信コントロールを特定する')

    const broker = await runBroker({ debugPort, credentialPath, decision: checked })
    const brokerResult = JSON.parse(broker.stdout.trim())
    ok(brokerResult.status === 'submitted', '秘密値を親プロセスへ返さずログイン操作を完了する')
    ok(!broker.stdout.includes('fixture-user') && !broker.stdout.includes('fixture-password'), 'ブローカー標準出力に秘密値を残さない')
    const pageState = await readSafePageState(debugPort, origin)
    ok(pageState.result === 'ok', '合成資格情報で偽ログインに成功する')
    ok(pageState.passwordValuePresent === false, '送信後にパスワードをDOMへ残さない')

    await navigateTarget(debugPort, origin, `${origin}/mfa`)
    const mfaPage = await waitForSummary(debugPort, origin, (summary) => summary.blockers.includes('mfa'))
    ok(mfaPage.summary.blockers.includes('mfa'), 'MFAを検出する')
    const mfaResult = JSON.parse((await runBroker({ debugPort, credentialPath, decision: checked })).stdout.trim())
    ok(mfaResult.status === 'stopped' && mfaResult.reason.includes('mfa'), 'MFAでは復号・入力前に停止する')

    await navigateTarget(debugPort, origin, `${origin}/captcha`)
    const captchaPage = await waitForSummary(debugPort, origin, (summary) => summary.blockers.includes('captcha'))
    ok(captchaPage.summary.blockers.includes('captcha'), 'CAPTCHAを検出する')
    const captchaResult = JSON.parse((await runBroker({ debugPort, credentialPath, decision: checked })).stdout.trim())
    ok(captchaResult.status === 'stopped' && captchaResult.reason.includes('captcha'), 'CAPTCHAでは復号・入力前に停止する')

    await navigateTarget(debugPort, origin, `${otherOrigin}/login`)
    await waitForSummary(debugPort, otherOrigin, (summary) => summary.fields.length === 3)
    const mismatch = await runBroker({ debugPort, credentialPath, decision: checked }).then(
      () => null,
      (error) => error
    )
    ok(mismatch && mismatch.code !== 0, '登録外originでは入力を拒否する')
    const mismatchText = `${mismatch?.stdout || ''}${mismatch?.stderr || ''}`
    ok(!mismatchText.includes('fixture-user') && !mismatchText.includes('fixture-password'), '失敗ログにも秘密値を残さない')
  } finally {
    chrome?.kill()
    await fixture.close()
    await delay(200)
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }

  process.stdout.write(`ローカル資格情報ブローカー: ${checks}項目成功\n`)
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`)
  process.exitCode = 1
})
