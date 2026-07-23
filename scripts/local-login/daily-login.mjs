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
// 使い方: node scripts/local-login/daily-login.mjs --portal <id> [--headful] [--timeout-ms N]
// 既定はheadless。初回はMFA等を本人が通すため --headful を推奨(READMEを参照)。

import { spawn } from 'node:child_process'
import { access, mkdir, readFile, appendFile, constants } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import {
  analyzeDeterministically,
  brokerFill,
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

// Chromeが --remote-debugging-port=0 で選んだ実ポートを DevToolsActivePort から読む。
async function readDebugPort(userDataDir, chromeProcess) {
  const portFile = join(userDataDir, 'DevToolsActivePort')
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (chromeProcess.exitCode != null) throw new Error(`Chromeが終了しました: ${chromeProcess.exitCode}`)
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

async function writeLog(entry) {
  const logDir = join(repoRoot, 'logs')
  await mkdir(logDir, { recursive: true })
  const day = new Date().toISOString().slice(0, 10)
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n'
  await appendFile(join(logDir, `local-login-${day}.log`), line, 'utf8')
}

async function run(portalId, { headful, timeoutMs }) {
  const credentialPath = join(repoRoot, 'credential-store', `${portalId}.json`)
  if (!(await exists(credentialPath))) {
    return { status: 'skipped', portalId, origin: null, reason: 'no_credential_record' }
  }
  // allowedOriginは公開情報。レコードから読み、loginUrlのoriginと突合する(秘密値には触れない)。
  const record = JSON.parse((await readFile(credentialPath, 'utf8')).replace(/^\uFEFF/, ''))
  const allowedOrigin = normalizeAllowedOrigin(record.allowedOrigin, { allowLoopbackHttp: true })

  const registry = JSON.parse(await readFile(join(scriptDir, 'portals.json'), 'utf8'))
  const portal = registry.portals?.[portalId]
  if (!portal) return { status: 'error', portalId, origin: allowedOrigin, reason: 'portal_not_in_registry' }
  const loginUrl = portal.loginUrl
  if (new URL(loginUrl).origin !== allowedOrigin) {
    return { status: 'error', portalId, origin: allowedOrigin, reason: 'login_url_origin_mismatch' }
  }

  const chrome = await findChrome()
  const userDataDir = join(repoRoot, 'logs', 'local-login-profiles', portalId)
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

  const chromeProcess = spawn(chrome, args, { windowsHide: true, stdio: 'ignore' })
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
    chromeProcess.kill()
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const portalId = validatePortalId(args.portal)
  const headful = Boolean(args.headful) || process.env.LOCAL_LOGIN_HEADFUL === '1'
  const timeoutMs = Number.isInteger(Number(args['timeout-ms'])) ? Number(args['timeout-ms']) : 30000

  let outcome
  try {
    outcome = await run(portalId, { headful, timeoutMs })
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
