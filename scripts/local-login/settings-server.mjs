// このPCのブラウザだけに設定画面を提供する。外部サイト用CORSや汎用コマンド実行は設けない。
import { spawn } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { access, mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSettingsService, credentialRecordPath, SettingsError } from './settings.mjs'

export const SETTINGS_PORT = 18471
const root = fileURLToPath(new URL('../..', import.meta.url))
const here = fileURLToPath(new URL('.', import.meta.url))

// 秘密値はstdinだけで渡す。子プロセスの例外・stdout・stderrをHTTPやログへ転記しない。
function runFile(executable, args, input = '', timeout = 30000) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      stdout = ''
      if (error) reject(new SettingsError('PC上の処理を完了できませんでした。Windowsの権限やChromeの起動状態を確認してください。', 503))
      else resolve(value)
    }
    const timer = setTimeout(() => { child.kill(); finish(true) }, timeout)
    child.once('error', () => finish(true))
    child.stdin.on('error', () => finish(true))
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); if (stdout.length > 65536) { child.kill(); finish(true) } })
    child.stderr.resume()
    child.once('close', (code) => finish(code !== 0, stdout))
    child.stdin.end(input, 'utf8')
    input = ''
  })
}

export function windowsService() {
  const powershell = (file, args = [], input = '') => runFile('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(here, file), ...args,
  ], input)
  return createSettingsService({
    root,
    readSchedule: async () => JSON.parse((await powershell('schedule.ps1')).replace(/^\uFEFF/, '')),
    applySchedule: async ({ enabled, time }) => powershell('schedule.ps1', ['-Operation', 'Apply', '-At', time, ...(!enabled ? ['-Disabled'] : [])]),
    storeCredential: async (id, loginUrl, value, portal) => {
      await mkdir(join(root, 'credential-store'), { recursive: true })
      await powershell('store-credential.ps1', [
        '-PortalId', id, '-AllowedUrl', loginUrl, '-OutputPath', credentialRecordPath(root, id, portal), '-ReadFromStdin',
      ], `${value.username}\n${value.password}\n`)
    },
    openLogin: (id) => runFile(process.execPath, [join(here, 'daily-login.mjs'), '--portal', id, '--manual']),
  })
}

async function readJson(request) {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw new SettingsError('JSON形式で送信してください。', 415)
  let body = ''
  request.setEncoding('utf8')
  for await (const chunk of request) {
    body += chunk
    if (Buffer.byteLength(body) > 16384) throw new SettingsError('入力が長すぎます。', 413)
  }
  try { return JSON.parse(body) }
  catch { throw new SettingsError('入力内容を読み取れません。') }
  finally { body = '' }
}

export async function startSettingsServer({ service = windowsService(), port = SETTINGS_PORT, assetsRoot = join(root, 'board', 'dist') } = {}) {
  const token = randomBytes(32).toString('hex')
  let origin = ''
  let busy = false
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('X-Frame-Options', 'DENY')
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
    const json = (status, body) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(body)) }
    try {
      if (request.headers.host !== new URL(origin).host || !['127.0.0.1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress)) {
        throw new SettingsError('このPCの設定画面から接続してください。', 403)
      }
      const url = new URL(request.url, origin)
      if (url.origin !== origin || url.search) throw new SettingsError('接続先が不正です。', 400)
      const api = url.pathname.startsWith('/api/')
      if (api) {
        if ((request.headers.origin && request.headers.origin !== origin) ||
            (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin')) {
          throw new SettingsError('このPCの設定画面から操作してください。', 403)
        }
        if (url.pathname === '/api/local-login/session' && request.method === 'GET') {
          json(200, { service: 'katazuku-local-login', token }); return
        }
        const supplied = Buffer.from(String(request.headers['x-katazuku-token'] || ''))
        const expected = Buffer.from(token)
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new SettingsError('画面を開き直してください。', 401)
        if (url.pathname === '/api/local-login/state' && request.method === 'GET') {
          if (busy) throw new SettingsError('処理中です。少し待ってから再読み込みしてください。', 409)
          json(200, await service.state()); return
        }
        if (request.method !== 'POST') throw new SettingsError('利用できない操作です。', 405)
        if (request.headers.origin !== origin) throw new SettingsError('このPCの設定画面から操作してください。', 403)
        if (busy) throw new SettingsError('別の操作を処理中です。完了してから再実行してください。', 409)
        busy = true
        let value
        try {
          value = await readJson(request)
          if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SettingsError('入力内容を確認してください。')
          if (url.pathname === '/api/local-login/settings') {
            if (Object.keys(value).some((key) => !['preferences', 'revision'].includes(key))) throw new SettingsError('設定項目が不正です。')
            json(200, await service.save(value)); return
          }
          if (url.pathname === '/api/local-login/portals') { json(200, await service.configure(value)); return }
          const match = /^\/api\/local-login\/portals\/([a-zA-Z0-9][a-zA-Z0-9._-]{0,63})\/(credentials|login)$/.exec(url.pathname)
          if (!match) throw new SettingsError('利用できない操作です。', 404)
          if (match[2] === 'credentials') json(200, await service.credentials(match[1], value))
          else {
            if (Object.keys(value).some((key) => key !== 'revision')) throw new SettingsError('ログイン先はサービス一覧から選んでください。')
            json(200, await service.login(match[1], value))
          }
          return
        } finally {
          if (value) { delete value.username; delete value.password }
          busy = false
        }
      }
      if (request.method !== 'GET') throw new SettingsError('利用できない操作です。', 405)
      let file
      let type
      if (['/', '/board/', '/board/local-login/'].includes(url.pathname)) {
        file = join(assetsRoot, 'index.html'); type = 'text/html; charset=utf-8'
        if (url.pathname !== '/board/local-login/') { response.writeHead(302, { Location: '/board/local-login/' }); response.end(); return }
      } else if (/^\/board\/(local-login\/)?assets\/[a-zA-Z0-9_-]+\.(js|css)$/.test(url.pathname)) {
        file = join(assetsRoot, 'assets', url.pathname.split('/').at(-1))
        type = file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8'
      } else if (/^\/icons\/(necktie-192|necktie-apple-touch|favicon-16|favicon-32)\.png$/.test(url.pathname)) {
        const name = url.pathname.split('/').at(-1)
        file = await access(join(assetsRoot, 'icons', name)).then(() => join(assetsRoot, 'icons', name), () => join(root, 'landing', 'icons', name)); type = 'image/png'
      } else throw new SettingsError('ページがありません。', 404)
      const body = await readFile(file).catch(() => { throw new SettingsError('設定画面を準備できませんでした。npm run local-login:settings で起動してください。', 503) })
      response.writeHead(200, { 'Content-Type': type }); response.end(body)
    } catch (error) {
      json(error instanceof SettingsError ? error.status : 503, {
        error: error instanceof SettingsError ? error.message : 'PCの設定を読み込めませんでした。Windowsの権限や設定ファイルを確認してください。',
      })
    }
  })
  server.requestTimeout = 15000
  server.headersTimeout = 10000
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  origin = `http://127.0.0.1:${server.address().port}`
  return { server, origin }
}

async function main() {
  if (process.platform !== 'win32') throw new Error('自動ログイン設定はWindows PCで起動してください。')
  const args = process.argv.slice(2)
  if (args.some((arg) => arg !== '--open')) throw new Error('引数が不正です。')
  await access(join(root, 'board', 'dist', 'index.html'))
  const { origin } = await startSettingsServer()
  const url = `${origin}/board/local-login/`
  console.log(`自動ログイン設定: ${url}`)
  if (args.includes('--open')) {
    // 本人が設定するために明示的に開くブラウザは表示する。サーバー側のコンソールは隠す。
    await runFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process '${url}' -WindowStyle Normal`])
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.code === 'EADDRINUSE'
      ? `設定画面は起動済み、またはポートが使用中です。http://127.0.0.1:${SETTINGS_PORT}/board/local-login/ を確認してください。`
      : '設定画面を起動できませんでした。Windows・Node.js・画面のビルドを確認してください。')
    process.exitCode = 1
  })
}
