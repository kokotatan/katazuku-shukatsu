// 毎日ログインのランナー(足場)。
//
// 契約(spec13 と broker.mjs/lib.mjs に従う):
// - このプロセスはパスワードを一切見ない。秘密値の復号と入力は broker(brokerFill)が
//   別プロセス(unprotect-credential.ps1)経由で行う。ランナーは欄番号の判定と起動だけを担う。
// - 対象は「専用の隔離Chromeプロファイル」だけ(普段使いのChromeには接続しない。spec13の境界)。
//   プロファイルは logs/local-login-profiles/<portal> に永続化し、セッションを日跨ぎで保つ。
// - MFA / CAPTCHA / origin不一致 / 欄が一意でない場合は入力せず停止する。
// - ログに残すのは status / reason / portal_id / origin と時刻だけ。ID・パスワードは残さない。
//
// 使い方: node scripts/local-login/daily-login.mjs --portal <id> [--headful] [--manual] [--timeout-ms N]
// 既定はheadless。初回はMFA等を本人が通すため --headful を推奨(READMEを参照)。
// --manual は remote-debuggingを付けない素のChromeを開いて
// 本人がIdP(Google等)でサインインするための入口(セッションは隔離プロファイルに残る)。

import { spawn } from 'node:child_process'
import { access, mkdir, readFile, appendFile, rm, constants } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { scheduledPortalIds, readRegistry, credentialRecordPath, profileDirectoryId } from './settings.mjs'
import {
  analyzeDeterministically,
  brokerFill,
  classifySsoSessionState,
  normalizeAllowedOrigin,
  readPageSummary,
  validatePortalId
} from './lib.mjs'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const scriptDir = fileURLToPath(new URL('.', import.meta.url))
const unprotectScript = join(scriptDir, 'unprotect-credential.ps1')

function parseArgs(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (key === '--headful') { result.headful = true; continue }
    if (key === '--manual') { result.manual = true; continue }
    if (key === '--keep-open') { result.keepOpen = true; continue }
    if (key === '--scheduled') { result.scheduled = true; continue }
    if (!key.startsWith('--') || index + 1 >= argv.length) throw new Error(`引数が不正です: ${key}`)
    result[key.slice(2)] = argv[index + 1]
    index += 1
  }
  return result
}

async function exists(path) {
  try { await access(path, constants.F_OK); return true } catch { return false }
}

async function findChrome() {
  const override = process.env.LOCAL_LOGIN_CHROME
  const candidates = [
    override,
    join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate
  }
  throw new Error('chrome.exeが見つかりません(LOCAL_LOGIN_CHROMEで明示指定してください)')
}

// 前回のDevToolsActivePortを消してからChromeを起動する。
// kill()で終わらせた回のファイルが残っていると、次回の起動直後に「前回のポート」を読んでしまい、
// 接続が全部ECONNREFUSEDになって login_page_not_reached に化ける(2026-07-30から毎朝失敗していた)。
async function clearDebugPort(userDataDir) {
  await rm(join(userDataDir, 'DevToolsActivePort'), { force: true })
}

// Chromeが --remote-debugging-port=0 で選んだ実ポートを DevToolsActivePort から読む。
async function readDebugPort(userDataDir, chromeProcess) {
  const portFile = join(userDataDir, 'DevToolsActivePort')
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (chromeProcess.exitCode != null) {
      // 21 = ProcessSingleton。同じプロファイルを別のChrome(--manualで開いた窓の閉じ忘れ等)が掴んでいる。
      // 理由が分からないと毎朝同じ失敗を繰り返すため、原因を名前で残す。
      if (chromeProcess.exitCode === 21) throw new Error('profile_locked_by_another_chrome')
      throw new Error(`Chromeが終了しました: ${chromeProcess.exitCode}`)
    }
    try {
      const contents = await readFile(portFile, 'utf8')
      const port = Number(contents.split('\n')[0].trim())
      if (Number.isInteger(port) && port >= 1024) return port
    } catch {}
    await delay(250)
  }
  throw new Error('DevToolsActivePortを取得できませんでした')
}

// ログインフォームが描画されるまで(=password欄が現れるまで)待つ。
// 既にログイン済みならフォームが出ないので、その状態はno_login_formとして扱う。
async function waitForLoginState(debugPort, allowedOrigin, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastSummary = null
  while (Date.now() < deadline) {
    try {
      const { summary } = await readPageSummary(debugPort, allowedOrigin)
      lastSummary = summary
      if (summary.blockers.length) return { summary }
      const hasPassword = summary.fields.some((field) => field.type === 'password' && !field.disabled)
      if (hasPassword) return { summary }
    } catch {
      // originのタブがまだ無い/一意でない等。描画待ちのためリトライ。
    }
    await delay(500)
  }
  return { summary: lastSummary }
}

// SSOポータル用。パスワード欄が無いため、ログインページから抜けたかどうかでセッションの生死を見る。
async function waitForSsoState(debugPort, allowedOrigin, loginUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    try {
      const { target, summary } = await readPageSummary(debugPort, allowedOrigin)
      last = { url: target.url, blockers: summary.blockers }
      if (summary.blockers.length) return last
      if (classifySsoSessionState(target.url, loginUrl) === 'active') return last
    } catch {
      // originのタブがまだ無い/一意でない等。SPAの描画待ちのためリトライ。
    }
    await delay(500)
  }
  return last
}

async function writeLog(entry) {
  const logDir = join(repoRoot, 'logs')
  await mkdir(logDir, { recursive: true })
  const day = new Date().toISOString().slice(0, 10)
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n'
  await appendFile(join(logDir, `local-login-${day}.log`), line, 'utf8')
}

// SSOポータルの毎日ログイン。パスワードを持たないのでブローカーは呼ばず、
// 隔離プロファイルに残ったセッションが生きているかを確かめて温めるだけにする。
async function runSso(portalId, portal, { headful, timeoutMs, manual, keepOpen }) {
  const loginUrl = portal.loginUrl
  const allowedOrigin = normalizeAllowedOrigin(new URL(loginUrl).origin)
  const chrome = await findChrome()
  const userDataDir = join(repoRoot, 'logs', 'local-login-profiles', profileDirectoryId(portalId, portal))
  await mkdir(userDataDir, { recursive: true })

  const baseArgs = [
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--no-service-autorun',
    '--disable-features=Translate,MediaRouter',
    '--disable-sync'
  ]

  // 初回の本人ログイン専用。IdP(Google等)は自動化フラグ付きのブラウザからのサインインを拒む
  // ことがあるため、remote-debuggingを付けずに素のChromeとして開き、操作は本人に委ねる。
  if (manual) {
    const chromeProcess = spawn(chrome, [...baseArgs, loginUrl], { detached: true, stdio: 'ignore' })
    await new Promise((resolve, reject) => { chromeProcess.once('spawn', resolve); chromeProcess.once('error', reject) })
    chromeProcess.unref()
    return { status: 'manual_launched', portalId, origin: allowedOrigin, reason: 'sign_in_then_close_window' }
  }

  const args = [...baseArgs, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1']
  if (!headful) args.push('--headless=new')
  args.push(loginUrl)

  await clearDebugPort(userDataDir)
  const chromeProcess = spawn(chrome, args, { windowsHide: true, stdio: 'ignore', detached: keepOpen })
  try {
    const debugPort = await readDebugPort(userDataDir, chromeProcess)
    const state = await waitForSsoState(debugPort, allowedOrigin, loginUrl, timeoutMs)
    if (!state) return { status: 'error', portalId, origin: allowedOrigin, reason: 'login_page_not_reached' }
    if (state.blockers.length) {
      return { status: 'stopped', portalId, origin: allowedOrigin, reason: state.blockers.join(',') }
    }
    const classification = classifySsoSessionState(state.url, loginUrl)
    if (classification === 'active') {
      return { status: 'no_login_form', portalId, origin: allowedOrigin, reason: 'sso_session_active' }
    }
    // セッション切れ。SSOは本人がIdPで認証するしかないので、入力は試みず停止して知らせる。
    return {
      status: 'stopped',
      portalId,
      origin: allowedOrigin,
      reason: classification === 'offsite' ? 'sso_redirected_offsite' : 'sso_session_expired_manual_login_required'
    }
  } finally {
    if (keepOpen) chromeProcess.unref()
    else chromeProcess.kill()
  }
}

async function run(portalId, { headful, timeoutMs, manual, keepOpen }) {
  const registry = await readRegistry(repoRoot)
  const portalEntry = registry[portalId]
  if (!portalEntry) return { status: 'error', portalId, origin: null, reason: 'portal_not_in_registry' }
  // ID・パスワード方式も本人が専用Chromeで初回認証できる。資格情報が未登録でも開ける。
  if (manual) return runSso(portalId, portalEntry, { headful, timeoutMs, manual: true, keepOpen })
  if (portalEntry.authMode === 'sso') return runSso(portalId, portalEntry, { headful, timeoutMs, manual, keepOpen })

  const credentialPath = credentialRecordPath(repoRoot, portalId, portalEntry)
  if (!(await exists(credentialPath))) {
    return { status: 'skipped', portalId, origin: null, reason: 'no_credential_record' }
  }
  // allowedOriginは公開情報。レコードから読み、loginUrlのoriginと突合する(秘密値には触れない)。
  const record = JSON.parse((await readFile(credentialPath, 'utf8')).replace(/^\uFEFF/, ''))
  const allowedOrigin = normalizeAllowedOrigin(record.allowedOrigin, { allowLoopbackHttp: true })

  const loginUrl = portalEntry.loginUrl
  if (new URL(loginUrl).origin !== allowedOrigin) {
    return { status: 'error', portalId, origin: allowedOrigin, reason: 'login_url_origin_mismatch' }
  }

  const chrome = await findChrome()
  const userDataDir = join(repoRoot, 'logs', 'local-login-profiles', profileDirectoryId(portalId, portalEntry))
  await mkdir(userDataDir, { recursive: true })

  const args = [
    `--user-data-dir=${userDataDir}`,
    '--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1',
    '--no-first-run',
    '--no-default-browser-check',
    '--no-service-autorun',
    '--disable-background-networking',
    '--disable-features=Translate,MediaRouter',
    '--disable-sync'
  ]
  if (!headful) args.push('--headless=new')
  args.push(loginUrl)

  await clearDebugPort(userDataDir)
  const chromeProcess = spawn(chrome, args, { windowsHide: true, stdio: 'ignore', detached: keepOpen })
  try {
    const debugPort = await readDebugPort(userDataDir, chromeProcess)
    const { summary } = await waitForLoginState(debugPort, allowedOrigin, timeoutMs)
    if (!summary) return { status: 'error', portalId, origin: allowedOrigin, reason: 'login_page_not_reached' }
    if (summary.blockers.length) {
      return { status: 'stopped', portalId, origin: allowedOrigin, reason: summary.blockers.join(',') }
    }
    const hasPassword = summary.fields.some((field) => field.type === 'password' && !field.disabled)
    if (!hasPassword) {
      // フォームが無い=概ねログイン済み(セッション有効)。安全に完了扱いにする。
      return { status: 'no_login_form', portalId, origin: allowedOrigin, reason: 'likely_already_authenticated' }
    }
    const decision = analyzeDeterministically(summary, portalId)
    if (decision.action === 'stop') {
      return { status: 'stopped', portalId, origin: allowedOrigin, reason: decision.reason }
    }
    // ここからが唯一の秘密値経路。brokerがoriginと欄typeを再検証し、DPAPI復号→入力→送信を自プロセスで完結する。
    const result = await brokerFill({
      portalId,
      credentialPath,
      decision,
      debugPort,
      unprotectScript,
      submit: true
    })
    return { status: result.status, portalId, origin: result.origin, reason: result.reason ?? null }
  } finally {
    if (keepOpen) chromeProcess.unref()
    else chromeProcess.kill()
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const portalId = validatePortalId(args.portal)
  const headful = Boolean(args.headful) || process.env.LOCAL_LOGIN_HEADFUL === '1'
  const manual = Boolean(args.manual)
  const keepOpen = Boolean(args.keepOpen)
  const timeoutMs = Number.isInteger(Number(args['timeout-ms'])) ? Number(args['timeout-ms']) : 30000

  let outcome
  try {
    if (args.scheduled && !(await scheduledPortalIds(repoRoot)).includes(portalId)) {
      outcome = { status: 'skipped', portalId, origin: null, reason: 'disabled_in_settings' }
    } else {
      outcome = await run(portalId, { headful, timeoutMs, manual, keepOpen })
    }
  } catch (error) {
    outcome = { status: 'error', portalId, origin: null, reason: error.message }
  }
  await writeLog(outcome)
  process.stdout.write(`${JSON.stringify(outcome)}\n`)
  if (outcome.status === 'error') process.exitCode = 1
}

main().catch(async (error) => {
  const outcome = { status: 'error', portalId: null, origin: null, reason: error.message }
  try { await writeLog(outcome) } catch {}
  process.stderr.write(`${JSON.stringify(outcome)}\n`)
  process.exitCode = 1
})
