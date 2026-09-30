/**
 * katazuku デスクトップアプリのメインプロセス(骨組み)。
 *
 * 方針(docs/DESKTOP-APP.md):
 * - すべてローカル。katazuku 側のサーバは使わない。
 * - 画面(renderer)には最小のAPIだけを preload 経由で渡す。任意のコマンド文字列は受け取らない。
 * - 既存のコア(scripts/ と src/)を固定の引数で呼ぶだけで、送信・提出の能力は増やさない。
 */
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
/** リポジトリ直下(骨組みではリポジトリから起動する前提。パッケージ版では同梱先に変える: TODO) */
const repo = join(here, '..')
const tsxCli = join(repo, 'node_modules', 'tsx', 'dist', 'cli.mjs')

function onPath(command) {
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', ''] : ['']
  return (process.env.PATH ?? '').split(delimiter).some((dir) =>
    extensions.some((extension) => dir && existsSync(join(dir, command + extension))))
}

/** 固定の引数でリポジトリ内のスクリプトを動かす。ELECTRON_RUN_AS_NODE で同梱の Node として実行する */
function runScript(script, args = []) {
  return new Promise((resolve) => {
    if (!existsSync(tsxCli)) {
      resolve({ ok: false, output: '依存が入っていません。リポジトリで npm install を実行してください。' })
      return
    }
    const child = spawn(process.execPath, [tsxCli, script, ...args], {
      cwd: repo,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true,
    })
    let output = ''
    child.stdout.on('data', (chunk) => { output += String(chunk) })
    child.stderr.on('data', (chunk) => { output += String(chunk) })
    child.on('error', (error) => resolve({ ok: false, output: error.message }))
    child.on('close', (code) => resolve({ ok: code === 0, output: output.slice(-4000) }))
  })
}

function status() {
  const configPath = join(repo, 'katazuku.config.json')
  let config
  try { config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : undefined } catch { config = undefined }
  return {
    platform: process.platform,
    repoReady: existsSync(tsxCli),
    config: config ? { displayName: config.profile?.displayName ?? '', accounts: (config.google?.accounts ?? []).length } : null,
    database: existsSync(join(repo, 'data', 'katazuku.db')),
    providers: {
      claude: onPath('claude'),
      codex: onPath('codex'),
    },
  }
}

/**
 * ウィザードの入力から設定ファイルを作る。受け取るのは決まった項目だけ。
 * 形の検証はワークフロー起動時にもスキーマで行われる(二重の検証)。
 */
function saveConfig(input) {
  const text = (value, max = 200) => String(value ?? '').slice(0, max)
  const email = text(input?.email, 254)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, output: 'メールアドレスの形が正しくありません' }
  const config = {
    $schema: './schemas/katazuku-config.schema.json',
    profile: {
      displayName: text(input?.displayName, 40),
      timezone: 'Asia/Tokyo',
      signature: String(input?.signature ?? '').split(/\r?\n/).map((line) => line.slice(0, 120)).filter(Boolean).slice(0, 8),
    },
    google: { accounts: [{ id: 'main', email, primary: true, calendars: 'all-visible' }] },
    agent: { providerOrder: Array.isArray(input?.providerOrder) ? input.providerOrder.filter((name) => ['chatgpt-siwc', 'claude-cli', 'codex-cli'].includes(name)) : ['claude-cli'] },
    notify: { selfEmail: false, desktop: true },
  }
  const path = join(repo, 'katazuku.config.json')
  if (existsSync(path) && !input?.overwrite) return { ok: false, output: '設定ファイルが既にあります(上書きする場合は確認してください)' }
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', 'utf8')
  return { ok: true, output: '設定を保存しました' }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 960,
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

ipcMain.handle('katazuku:status', () => status())
ipcMain.handle('katazuku:save-config', (_event, input) => saveConfig(input))
// 以下は固定コマンドだけ。画面から任意のコマンドは渡せない
ipcMain.handle('katazuku:chatgpt-signin', () => runScript('scripts/chatgpt.ts', ['signin']))
ipcMain.handle('katazuku:chatgpt-status', () => runScript('scripts/chatgpt.ts', ['status']))
ipcMain.handle('katazuku:dry-run', () => runScript('scripts/workflow.ts', ['asa', '--dry-run']))
ipcMain.handle('katazuku:schedule-preview', () => runScript('scripts/print-schedule.ts', [process.platform === 'darwin' ? 'launchd' : process.platform === 'linux' ? 'systemd' : 'cron']))
ipcMain.handle('katazuku:open-docs', (_event, page) => {
  const allowed = { setup: 'docs/SETUP.md', providers: 'docs/AI-PROVIDERS.md', workflows: 'docs/WORKFLOWS.md' }
  if (allowed[page]) shell.openPath(join(repo, allowed[page]))
})
// TODO: 定期実行の登録(Windows は register-tasks.ps1、macOS は launchd、Linux は systemd --user)を
//       確認ダイアログ付きで実行する。骨組みでは登録内容の表示まで。
// TODO: 閲覧アプリをアプリ内で開く(snapshot を書き出し、ビルド済みの board を file:// で読み込む)。

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
