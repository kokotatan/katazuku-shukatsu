/**
 * katazuku デスクトップアプリのメインプロセス。
 *
 * 方針(docs/DESKTOP-APP.md):
 * - 個人データはローカルに保存。本人が接続したGoogle・AIには通信する。
 * - 画面(renderer)には最小のAPIだけを preload 経由で渡す。任意のコマンド文字列は受け取らない。
 * - 既存のコア(scripts/ と src/)を固定の引数で呼ぶだけで、送信・提出の能力は増やさない。
 */
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createViewerServer } from '../tools/viewer-server.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = app.isPackaged ? join(here, '..', 'runtime') : join(here, '..')
const tsxCli = join(repo, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const children = new Set()
let viewerServer
let viewerWindow
let demoStarting
app.setName('katazuku')
// 配布物の実機検証だけは、明示した一時プロファイルと非表示ウィンドウを使う。
const testProfile = app.commandLine.getSwitchValue('test-profile')
if (testProfile) {
  if (!isAbsolute(testProfile)) throw new Error('検証用プロファイルは絶対パスで指定してください')
  app.setPath('userData', testProfile)
}
const showWindow = !(testProfile && app.commandLine.hasSwitch('test-hidden'))

function childEnvironment() {
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  if (app.isPackaged) {
    // 配布版は開発用の個人設定・DBの環境変数を引き継がない。
    for (const key of Object.keys(env)) if (/^KATAZUKU_/i.test(key)) delete env[key]
    const state = app.getPath('userData')
    mkdirSync(state, { recursive: true })
    env.KATAZUKU_CONFIG = join(state, 'katazuku.config.json')
    env.KATAZUKU_DB = join(state, 'data', 'katazuku.db')
    env.KATAZUKU_CHATGPT_DIR = join(state, 'chatgpt')
    env.KATAZUKU_GOOGLE_CREDENTIALS_DIR = join(state, 'google')
  }
  return env
}

function onPath(command) {
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', ''] : ['']
  return (process.env.PATH ?? '').split(delimiter).some((dir) =>
    extensions.some((extension) => dir && existsSync(join(dir, command + extension))))
}

/** 固定の引数でリポジトリ内のスクリプトを動かす。ELECTRON_RUN_AS_NODE で同梱の Node として実行する */
function runScript(script, args = [], input) {
  return new Promise((resolve) => {
    if (!existsSync(tsxCli)) {
      resolve({ ok: false, output: app.isPackaged ? '実行用ファイルがありません。配布フォルダーをすべて展開し直してください。' : '依存が入っていません。リポジトリで npm install を実行してください。' })
      return
    }
    const child = spawn(process.execPath, [tsxCli, script, ...args], {
      cwd: repo,
      env: childEnvironment(),
      windowsHide: true,
    })
    let output = ''
    children.add(child)
    const timeout = setTimeout(() => child.kill(), 300_000)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdin.on('error', () => {})
    child.stdin.end(input)
    child.stdout.on('data', (chunk) => { output = (output + String(chunk)).slice(-4000) })
    child.stderr.on('data', (chunk) => { output = (output + String(chunk)).slice(-4000) })
    child.on('error', (error) => resolve({ ok: false, output: error.message }))
    child.on('close', (code) => { clearTimeout(timeout); children.delete(child); resolve({ ok: code === 0, output }) })
  })
}

function status() {
  const env = childEnvironment()
  const configPath = env.KATAZUKU_CONFIG || join(repo, 'katazuku.config.json')
  let config
  try { config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : undefined } catch { config = undefined }
  return {
    platform: process.platform,
    packaged: app.isPackaged,
    repoReady: existsSync(tsxCli),
    config: config ? { displayName: config.profile?.displayName ?? '', accounts: (config.google?.accounts ?? []).length } : null,
    database: existsSync(env.KATAZUKU_DB || join(repo, 'data', 'katazuku.db')),
    providers: {
      claude: onPath('claude'),
      codex: onPath('codex'),
    },
  }
}

async function openDemo() {
  if (viewerWindow && !viewerWindow.isDestroyed()) { viewerWindow.focus(); return { ok: true, output: '架空データの画面を開きました。' } }
  if (demoStarting) return demoStarting
  demoStarting = (async () => {
    try {
      if (!viewerServer) {
        viewerServer = createViewerServer({ root: repo, demo: true })
        await new Promise((resolve, reject) => {
          viewerServer.once('error', reject)
          viewerServer.listen(0, '127.0.0.1', resolve)
        })
      }
      const origin = `http://127.0.0.1:${viewerServer.address().port}`
      viewerWindow = new BrowserWindow({ width: 1200, height: 850, show: showWindow, title: 'katazuku — 架空データ',
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } })
      viewerWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      viewerWindow.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== origin) event.preventDefault() })
      viewerWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
      viewerWindow.on('closed', () => { viewerWindow = undefined })
      await viewerWindow.loadURL(origin)
      return { ok: true, output: '架空データの画面を開きました。閉じると設定画面に戻れます。' }
    } catch {
      viewerServer?.close(); viewerServer = undefined
      viewerWindow?.close(); viewerWindow = undefined
      return { ok: false, output: '閲覧画面を開けませんでした。配布フォルダーをすべて展開し直してください。' }
    } finally { demoStarting = undefined }
  })()
  return demoStarting
}

/**
 * ウィザードの入力から設定ファイルを作る。受け取るのは決まった項目だけ。
 * 保存前にコアのSchemaで検証する。入力はプロセスの引数に入れず標準入力で渡す。
 */
function saveConfig(input) {
  try { return runScript('scripts/desktop-config.ts', [], JSON.stringify(input)) }
  catch { return { ok: false, output: '設定の入力を確認してください。' } }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 960,
    show: showWindow,
    height: 720,
    title: 'katazuku',
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  // 外部サイトはアプリ内で開かず、既定のブラウザへ渡す
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.loadFile(join(here, 'renderer', 'index.html'))
}

function handle(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== pathToFileURL(join(here, 'renderer', 'index.html')).href) throw new Error('設定画面からだけ操作できます')
    return handler(event, ...args)
  })
}
handle('katazuku:status', () => status())
handle('katazuku:save-config', (_event, input) => saveConfig(input))
handle('katazuku:open-demo', () => openDemo())
// 以下は固定コマンドだけ。画面から任意のコマンドは渡せない
handle('katazuku:chatgpt-signin', () => runScript('scripts/chatgpt.ts', ['signin']))
handle('katazuku:chatgpt-status', () => runScript('scripts/chatgpt.ts', ['status']))
handle('katazuku:dry-run', () => runScript('scripts/workflow.ts', ['asa', '--dry-run']))
handle('katazuku:setup-check', () => runScript('scripts/setup-doctor.ts'))
handle('katazuku:schedule-preview', () => app.isPackaged
  ? { ok: false, output: '配布版からの定期登録はまだ対応していません。設定保存やデモ閲覧で自動実行は始まりません。' }
  : runScript('scripts/print-schedule.ts', [process.platform === 'darwin' ? 'launchd' : process.platform === 'linux' ? 'systemd' : 'cron']))
handle('katazuku:open-docs', (_event, page) => {
  const allowed = { setup: 'docs/SETUP.md', providers: 'docs/AI-PROVIDERS.md', workflows: 'docs/WORKFLOWS.md' }
  if (!Object.hasOwn(allowed, page)) return
  if (!app.isPackaged) { shell.openPath(join(repo, allowed[page])); return }
  // 配布先にMarkdownを開くアプリがなくても、同梱手順を読めるようにする。
  const text = readFileSync(join(repo, allowed[page]), 'utf8').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  const help = new BrowserWindow({ width: 960, height: 760, show: showWindow, title: 'katazuku — 手順', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  help.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  help.webContents.on('will-navigate', event => event.preventDefault())
  help.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><html lang="ja"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>katazuku の手順</title><style>body{max-width:850px;margin:36px auto;padding:20px;font:16px/1.8 sans-serif}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}</style><pre>${text}</pre></html>`))
})
// TODO: 定期実行の登録(Windows は register-tasks.ps1、macOS は launchd、Linux は systemd --user)を
//       確認ダイアログ付きで実行する。骨組みでは登録内容の表示まで。

app.whenReady().then(createWindow)
app.on('before-quit', () => { for (const child of children) child.kill(); viewerServer?.close(); viewerServer?.closeAllConnections() })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
