import { createServer } from 'node:http'
import { readFile, mkdir, writeFile, rename, access } from 'node:fs/promises'
import { hostname, homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { parseEnv } from 'node:util'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { startConnection } from '../google-workspace/connection.mjs'
import { createCloudSetup } from './cloud.mjs'

const directory = dirname(fileURLToPath(import.meta.url))
const token = () => randomBytes(32).toString('base64url')
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b))
const commonHeaders = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" }
class SetupError extends Error {}
const safeError = e => e instanceof SetupError ? e.message : '処理できませんでした。接続状態と保存フォルダを確認して、もう一度お試しください。'
function endpoint(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['/', '/api/push'].includes(url.pathname)) throw new SetupError('接続先はHTTPSのアプリURLを指定してください。')
  return url.origin
}
async function readOptional(path) { try { return await readFile(path, 'utf8') } catch (e) { if (e.code === 'ENOENT') return ''; throw e } }
async function boundedRequest(request) {
  let size = 0; const chunks = []
  for await (const chunk of request) { size += chunk.length; if (size > 4096) throw new SetupError('入力が長すぎます。'); chunks.push(chunk) }
  const result = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new SetupError('入力を確認してください。')
  return result
}
async function jsonFetch(fetcher, url, init) {
  const response = await fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(20_000) })
  const reader = response.body?.getReader(); if (!reader) throw new SetupError('保存先から応答がありません。')
  let size = 0; const chunks = []
  try { while (true) { const value = await reader.read(); if (value.done) break; size += value.value.length; if (size > 16384) { await reader.cancel(); throw new SetupError('保存先の応答が大きすぎます。') }; chunks.push(value.value) } }
  finally { reader.releaseLock() }
  const result = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!response.ok) throw new SetupError('保存先へ接続できませんでした。接続先とPCの設定を確認してください。')
  return result
}

export async function startSetup({ root = resolve(directory, '../..'), port = 18472, fetcher = fetch } = {}) {
  const environment = parseEnv(await readOptional(join(root, '.env')))
  const configPath = join(root, 'credentials', 'desktop-setup.json')
  let local = JSON.parse(await readOptional(configPath) || '{}')
  const packageInfo = JSON.parse(await readOptional(join(root, 'package.json')) || '{}')
  const privateApp = packageInfo.private === true
  const satellite = await access(join(root, '.katazuku-satellite')).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e })
  const cloud = privateApp ? null : await createCloudSetup(root)
  const configuredOrigin = environment.KATAZUKU_APP_ORIGIN ? endpoint(environment.KATAZUKU_APP_ORIGIN) : environment.KATAZUKU_PUSH_URL ? endpoint(environment.KATAZUKU_PUSH_URL) : ''
  const connection = () => ({ appOrigin: configuredOrigin || cloud?.getConfig()?.origin || '', writeSecret: environment.KATAZUKU_WRITE_SECRET || cloud?.getConfig()?.writeSecret || '' })
  const csrf = token(); let publicUrl, busy = false, google
  const send = (response, status, value) => { response.writeHead(status, { ...commonHeaders, 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value)) }
  const server = createServer(async (request, response) => {
    try {
      if (request.headers.host !== new URL(publicUrl).host) return send(response, 403, { error: 'このPCの設定画面から操作してください。' })
      const url = new URL(request.url, publicUrl)
      if (url.search) return send(response, 400, { error: 'URLに設定情報を含めないでください。' })
      const assets = { '/': ['index.html', 'text/html'], '/setup.js': ['setup.js', 'text/javascript'], '/setup.css': ['setup.css', 'text/css'] }
      if (request.method === 'GET' && assets[url.pathname]) {
        const [file, type] = assets[url.pathname]; response.writeHead(200, { ...commonHeaders, 'Content-Type': type + '; charset=utf-8' }); return response.end(await readFile(join(directory, file)))
      }
      if (request.method === 'GET' && url.pathname === '/api/status') {
        const { appOrigin, writeSecret } = connection()
        return send(response, 200, { service: 'katazuku-setup', csrf, deviceName: local.deviceName || cloud?.getConfig()?.deviceName || (satellite ? '自分のMiniPC' : hostname()), workspace: root, satellite, database: satellite ? 'MiniPCの正本データ（このPCは認証・確認用）' : cloud?.getConfig()?.database || resolve(root, environment.KATAZUKU_DB || 'data/katazuku.db'), dataFolder: cloud?.getConfig()?.database ? dirname(cloud.getConfig().database) : local.dataFolder || join(homedir(), 'Documents', 'katazuku'), cloud: cloud?.getStatus() || null, appOrigin, cloudReady: Boolean(appOrigin && writeSecret), syncReady: Boolean(cloud?.getConfig()?.origin), google: google?.getState() || null, account: local.account || '', busy })
      }
      if (request.method !== 'POST' || request.headers.origin !== publicUrl || !equal(request.headers['x-katazuku-csrf'], csrf)) return send(response, 403, { error: 'このPCの設定画面から操作してください。' })
      if (request.headers['content-type']?.split(';')[0] !== 'application/json') return send(response, 415, { error: '送信形式が正しくありません。' })
      const input = await boundedRequest(request)
      if (busy) return send(response, 409, { error: '処理中です。少し待ってからお試しください。' })
      busy = true
      try {
        if (url.pathname === '/api/cloud/login' && cloud) { cloud.login(); return send(response, 202, { started: true }) }
        if (url.pathname === '/api/cloud/accounts' && cloud) return send(response, 200, { accounts: await cloud.accounts() })
        if (url.pathname === '/api/cloud/create' && cloud) { cloud.create(input); return send(response, 202, { started: true }) }
        if (url.pathname === '/api/cloud/sync' && cloud) { cloud.sync(); return send(response, 202, { started: true }) }
        if (url.pathname === '/api/folder' && cloud) {
          if (process.platform !== 'win32') throw new SetupError('このOSでは保存フォルダを入力してください。')
          const result = await promisify(execFile)('powershell.exe', ['-NoProfile', '-STA', '-File', join(directory, 'choose-folder.ps1')], { windowsHide: true, timeout: 300_000 })
          const selected = result.stdout.trim()
          if (selected) { local = { ...local, dataFolder: selected }; await saveLocal() }
          return send(response, 200, { path: selected })
        }
        if (url.pathname === '/api/password') {
          const { appOrigin, writeSecret } = connection()
          if (!appOrigin || !writeSecret) throw new SetupError('このPCの保存先が未設定です。先に保存先の導入を完了してください。')
          const deviceName = String(input.deviceName || '').trim()
          if (!deviceName || deviceName.length > 80) throw new SetupError('PCの名前を80文字以内で入力してください。')
          const result = await jsonFetch(fetcher, appOrigin + '/api/auth/setup-link', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${writeSecret}` }, body: JSON.stringify({ deviceName }) })
          if (typeof result.setupToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(result.setupToken)) throw new SetupError('保存先の初回設定に対応していません。アプリを更新してください。')
          local = { ...local, deviceName }; await saveLocal()
          return send(response, 200, { url: `${appOrigin}/setup/#setup=${result.setupToken}` })
        }
        if (url.pathname === '/api/google') {
          const account = String(input.account || '').trim().toLowerCase()
          if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(account)) throw new SetupError('連携するGoogleアカウントのメールアドレスを入力してください。')
          if (google) await google.close()
          google = await startConnection({ account, broker: environment.KATAZUKU_GOOGLE_BROKER_ORIGIN, credentialsDirectory: join(homedir(), '.google_workspace_mcp', 'common-credentials') })
          local = { ...local, account }; await saveLocal()
          return send(response, 200, { url: google.url })
        }
        return send(response, 404, { error: '操作が見つかりません。' })
      } finally { busy = false }
    } catch (e) { send(response, 400, { error: safeError(e) }) }
  })
  async function saveLocal() {
    await mkdir(dirname(configPath), { recursive: true, mode: 0o700 })
    const temporary = configPath + '.' + token() + '.tmp'
    await writeFile(temporary, JSON.stringify(local, null, 2), { flag: 'wx', mode: 0o600 }); await rename(temporary, configPath)
  }
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  publicUrl = 'http://127.0.0.1:' + server.address().port
  const timer = cloud ? setInterval(() => { void cloud.syncIfChanged().catch(() => {}) }, 60_000) : null
  timer?.unref()
  return { url: publicUrl, close: async () => { if (timer) clearInterval(timer); if (cloud) await cloud.whenIdle(); if (google) await google.close(); await new Promise((resolve, reject) => { server.close(e => e ? reject(e) : resolve()); server.closeIdleConnections() }) } }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.length && (args.length !== 2 || args[0] !== '--port' || !/^\d{1,5}$/.test(args[1]) || Number(args[1]) > 65535)) throw new Error('起動オプションを確認してください。')
  const setup = await startSetup({ port: args.length ? Number(args[1]) : 18472 })
  console.log('katazukuの設定: ' + setup.url)
  process.once('SIGINT', async () => { await setup.close(); process.exit() })
  process.once('SIGTERM', async () => { await setup.close(); process.exit() })
}
