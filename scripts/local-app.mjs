#!/usr/bin/env node
/** 8つの閲覧アプリを同じローカルURLから開く。操作の自動実行・外部配信はしない。 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createViewerServer, VIEWER_APPS } from '../tools/viewer-server.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const demo = argv.includes('--demo')
const noBuild = argv.includes('--no-build')
const noOpen = argv.includes('--no-open')
const refresh = argv.includes('--refresh')
let port = 4173
let app = ''
let dbArg
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i]
  if (['--demo', '--no-build', '--no-open', '--refresh'].includes(arg)) continue
  if (arg === '--port') { port = Number(argv[++i]); continue }
  if (arg === '--db') { dbArg = argv[++i]; if (!dbArg) throw new Error('--db にDBのパスが必要です'); continue }
  if (VIEWER_APPS.includes(arg) && !app) { app = arg; continue }
  throw new Error('指定できるのはアプリ名と --demo / --no-open / --no-build / --refresh / --port / --db です')
}
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port は1〜65535で指定してください')
if (demo && dbArg) throw new Error('デモでは --db を指定できません')
const [major, minor] = process.versions.node.split('.').map(Number)
if (!(major >= 24 || (major === 22 && minor >= 13))) throw new Error('Node.js 22.13以降の22系、または24以降（推奨24）が必要です')
// デモでは個人設定・.env・正本DBに触れない。
if (!demo && existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'))
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
function run(label, command, args, cwd = root) {
  console.log(label)
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' && command === npm, windowsHide: true })
  if (result.status !== 0) throw new Error(`${label}に失敗しました。上のエラーを確認してください。`)
}
const tsx = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs')
if (!existsSync(tsx)) run('依存を入れています（初回）', npm, ['ci', '--no-audit', '--no-fund'])
let dataAvailable = true
if (demo) {
  // --no-build は既存ビルドでの検証用。通常のデモは日付を更新して生成する。
  if (!noBuild || refresh || !existsSync(join(root, 'board', 'public', 'snapshot.demo.json'))) {
    run('架空データを準備しています', process.execPath, [tsx, 'scripts/snapshot.ts', '--demo', '--viewer'])
  }
} else {
  const db = dbArg || process.env.KATAZUKU_DB || process.env.KATAZUKU_DB_PATH || join(root, 'data', 'katazuku.db')
  if (existsSync(db)) run('正本DBから閲覧データを更新しています', process.execPath, [tsx, 'scripts/snapshot.ts', db])
  else {
    dataAvailable = false
    console.log('指定した正本DBがありません。ホームのセットアップ手順とDB指定を確認してください。過去の閲覧データ・空のDB・デモへの切り替えは行いません。')
  }
}
function changedSinceBuild(path, since) {
  if (!existsSync(path)) return false
  const entry = statSync(path)
  if (entry.isFile()) return entry.mtimeMs > since
  return readdirSync(path).some((name) => changedSinceBuild(join(path, name), since))
}
for (const name of VIEWER_APPS) {
  const appRoot = join(root, name)
  if (!noBuild) {
    if (!existsSync(join(appRoot, 'node_modules', 'vite'))) run(`${name} の依存を入れています（初回）`, npm, ['ci', '--no-audit', '--no-fund'], appRoot)
    const built = join(appRoot, 'dist', 'index.html')
    const since = existsSync(built) ? statSync(built).mtimeMs : 0
    const changed = ['src', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json']
      .some((path) => changedSinceBuild(join(appRoot, path), since)) || changedSinceBuild(join(root, 'shared', 'src'), since)
    if (refresh || !since || changed) run(`${name} をビルドしています`, npm, ['run', 'build'], appRoot)
  }
  if (!existsSync(join(appRoot, 'dist', 'index.html'))) throw new Error(`${name} のビルドがありません。--no-build を外して起動してください。`)
}
const server = createViewerServer({ root, demo, dataAvailable, briefsAvailable: dataAvailable && !dbArg })
server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE' ? `ポート${port}は使用中です。--port 4174 のように変更してください。` : 'ローカルサーバーを起動できませんでした。')
  process.exitCode = 1
})
server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${port}/${app ? `${app}/` : ''}`
  console.log(`\n${demo ? '架空データのデモ' : '自分のデータ（ローカル閲覧）'}: ${url}`)
  console.log('このPCからだけ開けます。終了は Ctrl+C。画面を開いてもワークフローは実行されません。')
  if (!noOpen) {
    const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
    const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url]
    const child = spawn(command, args, { stdio: 'ignore', windowsHide: true })
    child.on('error', () => console.log('ブラウザで上のURLを開いてください。'))
    child.unref()
  }
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(); server.closeAllConnections() })
