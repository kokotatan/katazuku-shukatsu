#!/usr/bin/env node
/**
 * 5分デモ: 資格情報もAIも無しで、架空データの画面を開く。
 *
 *   npm run demo                 # board(きょう / 選考 / 企業 / ログ)を開く
 *   npm run demo -- insight      # 別のアプリ(status / inbox / insight / people / prep / profile / impact)
 *   npm run demo -- --no-open    # ブラウザを自動で開かない
 *   npm run demo -- --refresh    # 同梱の架空データを作り直す
 *
 * やること: 依存の導入(初回だけ)→ 同梱の架空データ(A社〜F社)でアプリを起動。
 * 実データ・ネットワーク上のアカウントには一切触れない。書き出すのは snapshot.demo.json だけ。
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const APPS = ['board', 'status', 'inbox', 'insight', 'people', 'prep', 'profile', 'impact']
const args = process.argv.slice(2)
const app = args.find((arg) => !arg.startsWith('--')) ?? 'board'
const open = !args.includes('--no-open')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

if (!APPS.includes(app)) {
  console.error(`アプリ名は ${APPS.join(' / ')} のどれかです`)
  process.exit(1)
}
const [major, minor] = process.versions.node.split('.').map(Number)
if (!(major >= 24 || (major === 22 && minor >= 13))) {
  console.error(`Node.js 22.13以降の22系、または24以降が必要です(いまは ${process.versions.node})。推奨は 24 です。`)
  process.exit(1)
}

function run(label, command, commandArgs, cwd = root) {
  console.log(`\n> ${label}`)
  // Windows の npm.cmd は shell 経由でないと起動できない(引数は固定値だけなので安全)
  const result = spawnSync(command, commandArgs, { cwd, stdio: 'inherit', shell: process.platform === 'win32' && command === npm })
  if (result.status !== 0) {
    console.error(`\n失敗しました: ${label}`)
    process.exit(result.status ?? 1)
  }
}

// lockfile どおりに入れる(install だと lockfile が書き換わり、作業ツリーが汚れる)
if (!existsSync(join(root, 'node_modules', 'tsx'))) run('依存を入れる(初回だけ)', npm, ['ci', '--no-audit', '--no-fund'])
// 架空データのスナップショットは各アプリに同梱済み。作り直したいときだけ --refresh
if (args.includes('--refresh') || !existsSync(join(root, app, 'public', 'snapshot.demo.json'))) {
  run('架空データ(A社〜F社)のスナップショットを書き出す', process.execPath, [join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'scripts/snapshot.ts', '--demo'])
}
if (!existsSync(join(root, app, 'node_modules'))) run(`${app} の依存を入れる(初回だけ・1〜2分)`, npm, ['ci', '--no-audit', '--no-fund'], join(root, app))

console.log(`\n> ${app} を起動します。止めるときは Ctrl+C。`)
console.log('  いま見えているのは架空のデモデータです。自分のデータで使う手順は docs/SETUP.md を見てください。\n')
const child = spawn(npm, ['run', 'dev', '--', ...(open ? ['--open'] : [])], { cwd: join(root, app), stdio: 'inherit', shell: process.platform === 'win32' })
child.on('exit', (code) => process.exit(code ?? 0))
