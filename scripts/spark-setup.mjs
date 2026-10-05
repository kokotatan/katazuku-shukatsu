#!/usr/bin/env node
/**
 * Gemini Spark 連携を1コマンドで用意する。何度実行しても安全(作成済みのものは作り直さない)。
 *
 *   npm run spark:setup                         # workers.dev に立てる
 *   npm run spark:setup -- --domain spark.example.com   # 自分のドメインに立てる(Cloudflare管理のゾーン)
 *   npm run spark:setup -- --no-open            # 最後にブラウザと接続キーを開かない
 *   npm run spark:setup -- --no-register        # bridge を常駐登録しない(npm run spark:bridge を自分で起動する)
 *
 * やること:
 *   1. Cloudflare にログインしているか確認(未ログインならブラウザでログイン)
 *   2. OAuth 用 KV を作り、spark-gateway/wrangler.jsonc を生成(Worker名は重複しないよう乱数付き)
 *   3. 接続キーと bridge トークンを生成(spark-gateway/*.local.*。git対象外・画面に出さない)
 *   4. gateway をデプロイ(鍵も同時に登録)。workers.dev の URL を取得して PUBLIC_ORIGIN に設定し直す
 *   5. logs/spark-bridge.local.json を書き、bridge を常駐登録(Windows)。接続を確認する
 *   6. Gemini に貼る URL と、接続キーの場所を表示する
 *
 * 作るのは自分の Cloudflare アカウント内の Worker・KV・Durable Object だけ。
 * 正本DBは自分のPCに置いたまま。他人の Gemini からは接続キーなしでは使えない。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const gw = join(root, 'spark-gateway')
const configPath = join(gw, 'wrangler.jsonc')
const secretsPath = join(gw, 'secrets.local.json')
const ownerKeyPath = join(gw, 'owner-key.local.txt')
const bridgeConfigPath = join(root, 'logs', 'spark-bridge.local.json')
const args = process.argv.slice(2)
const domainIndex = args.indexOf('--domain')
const domain = domainIndex >= 0 ? args[domainIndex + 1] : undefined
const open = !args.includes('--no-open')
const register = !args.includes('--no-register')
if (domain !== undefined && !/^(?=.{1,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/i.test(domain)) fail('--domain にはホスト名だけを渡してください(例: spark.example.com)')

const step = (n, text) => console.log(`\n[${n}/6] ${text}`)
function fail(message) { console.error(`\n中断しました: ${message}`); process.exit(1) }
const wranglerBin = join(gw, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
/** wrangler を実行して出力を返す。interactive はログインなど本人の操作が要るとき */
function wrangler(argv, { interactive = false, allowFail = false } = {}) {
  const r = spawnSync(process.execPath, [wranglerBin, ...argv], { cwd: gw, encoding: 'utf8', stdio: interactive ? 'inherit' : 'pipe', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  if (r.status !== 0 && !allowFail) fail(`wrangler ${argv[0]} ${argv[1] ?? ''} が失敗しました\n${out.split(/\r?\n/).filter(Boolean).slice(-8).join('\n')}`)
  return { ok: r.status === 0, out }
}
const readJsonc = (path) => JSON.parse(readFileSync(path, 'utf8').replace(/^\s*\/\/.*$/gm, ''))
const writeJson = (path, value, secret = false) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { mode: secret ? 0o600 : 0o644 })
  if (secret && process.platform !== 'win32') chmodSync(path, 0o600)
}

// 0. 依存
if (!existsSync(wranglerBin)) {
  console.log('spark-gateway の依存を入れています…')
  const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--no-audit', '--no-fund'], { cwd: gw, stdio: 'inherit', shell: process.platform === 'win32' })
  if (r.status !== 0) fail('spark-gateway で npm ci が失敗しました')
}

step(1, 'Cloudflare のログインを確認')
if (!wrangler(['whoami'], { allowFail: true }).out.match(/associated with the email|You are logged in/i)) {
  console.log('ブラウザで Cloudflare にログインしてください(無料プランで動きます)。')
  wrangler(['login'], { interactive: true })
  if (!wrangler(['whoami'], { allowFail: true }).out.match(/associated with the email|You are logged in/i)) fail('Cloudflare にログインできませんでした')
}
console.log('ログイン済み')

step(2, 'KV と設定ファイル')
let config
if (existsSync(configPath)) {
  config = readJsonc(configPath)
  console.log(`既存の設定を使います(Worker: ${config.name})`)
} else {
  config = readJsonc(join(gw, 'wrangler.example.jsonc'))
  config.name = `katazuku-spark-${randomBytes(3).toString('hex')}`
  const kv = wrangler(['kv', 'namespace', 'create', `${config.name}-oauth`]).out
  const id = kv.match(/"id":\s*"([0-9a-f]{32})"/)?.[1] ?? kv.match(/id\s*=\s*"([0-9a-f]{32})"/)?.[1]
  if (!id) fail('作成した KV の ID を読み取れませんでした')
  config.kv_namespaces = [{ binding: 'OAUTH_KV', id }]
  config.vars = { PUBLIC_ORIGIN: domain ? `https://${domain}` : 'https://pending.invalid' }
  writeJson(configPath, config)
  console.log(`作成しました(Worker: ${config.name})`)
}
if (domain) {
  config.routes = [{ pattern: domain, custom_domain: true }]
  config.vars = { ...config.vars, PUBLIC_ORIGIN: `https://${domain}` }
  writeJson(configPath, config)
}

step(3, '接続キーと bridge トークン')
if (existsSync(secretsPath) && existsSync(ownerKeyPath)) console.log('既存のキーを使います')
else {
  const r = spawnSync(process.execPath, ['setup-secrets.mjs'], { cwd: gw, encoding: 'utf8' })
  if (r.status !== 0) fail(`キーを生成できませんでした: ${r.stderr}`)
  console.log('生成しました(画面には表示しません)')
}

step(4, 'gateway をデプロイ')
let deployed = wrangler(['deploy', '--secrets-file', 'secrets.local.json']).out
if (!domain) {
  const url = deployed.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i)?.[0]
  if (!url) fail('デプロイ先の workers.dev URL を読み取れませんでした。Cloudflare のダッシュボードで workers.dev サブドメインを有効にしてから再実行してください')
  if (config.vars.PUBLIC_ORIGIN !== url) {
    config.vars = { ...config.vars, PUBLIC_ORIGIN: url }
    writeJson(configPath, config)
    deployed = wrangler(['deploy']).out
  }
}
const origin = config.vars.PUBLIC_ORIGIN
let healthy = false
for (let i = 0; i < 20 && !healthy; i++) {
  try { healthy = (await fetch(`${origin}/health`)).ok } catch { /* DNS・証明書の反映待ち */ }
  if (!healthy) await new Promise((r) => setTimeout(r, 3000))
}
if (!healthy) fail(`${origin} に届きません。独自ドメインなら DNS・証明書の反映を待って再実行してください`)
console.log(`デプロイしました: ${origin}`)

step(5, 'bridge(自分のPC ↔ gateway)')
const { BRIDGE_TOKEN } = JSON.parse(readFileSync(secretsPath, 'utf8'))
writeJson(bridgeConfigPath, { origin, token: BRIDGE_TOKEN }, true)
const dbPath = process.env.KATAZUKU_DB ?? join(root, 'data', 'katazuku.db')
if (!existsSync(dbPath)) console.log(`注意: 正本DB(${dbPath})がまだありません。試すだけなら npm run seed -- data/katazuku.db でデモDBを作れます`)
if (!register) {
  console.log('常駐登録は省きました。npm run spark:bridge で bridge を起動してください')
} else if (process.platform === 'win32') {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts', 'register-spark-bridge.ps1')], { encoding: 'utf8' })
  if (r.status !== 0) fail(`bridge を常駐登録できませんでした\n${r.stderr}`)
  const log = join(root, 'logs', 'spark-driver', 'bridge.log')
  let connected = false
  for (let i = 0; i < 20 && !connected; i++) {
    await new Promise((r) => setTimeout(r, 3000))
    connected = existsSync(log) && readFileSync(log, 'utf8').split(/\r?\n/).slice(-5).some((l) => l.includes('Spark bridge connected'))
  }
  console.log(connected ? 'bridge が接続しました(ログオン中は常駐し、切れても自動で再接続します)' : `bridge の接続を確認できませんでした。${log} を見てください`)
} else {
  console.log('macOS / Linux では常駐登録を自動化していません。まず手元で動かしてください:')
  console.log('  npm run spark:bridge')
  console.log('常駐させる場合は launchd / systemd でこのコマンドを起動してください。')
}

step(6, 'Gemini に接続する(PC のブラウザで1回だけ)')
console.log(`
  1. PC のブラウザで https://gemini.google.com/apps を開く(スマホのアプリには追加欄がありません)
  2. ページ最下部「Spark のカスタムアプリ」に次の URL を入れて「次へ」
       ${origin}/mcp
  3. Google の同意のあと、katazuku の同意画面で「接続キー」を入れて「接続を許可」
       接続キー: ${ownerKeyPath}
     (パスワードマネージャーに保存しておくと楽です。Spark のチャットには貼らないでください)
  4. Spark で「@Katazuku Shukatsu 今日の就活の予定を教えて」と聞く。接続後はスマホからも使えます
`)
if (open && process.platform === 'win32') {
  spawnSync('cmd.exe', ['/c', 'start', '', 'https://gemini.google.com/apps'], { stdio: 'ignore' })
  spawnSync('cmd.exe', ['/c', 'start', '', 'notepad.exe', ownerKeyPath], { stdio: 'ignore' })
  console.log('ブラウザ(Gemini のアプリ連携)と、接続キーのファイルを開きました。')
}
