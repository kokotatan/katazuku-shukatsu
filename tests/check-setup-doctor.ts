/** 合成設定だけで診断の拒否・情報非開示を確認。実資格情報・通信・ログインは使わない。 */
import { strict as assert } from 'node:assert'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatSetupChecks, inspectSetup } from '../scripts/setup-doctor.js'

const root = mkdtempSync(join(tmpdir(), 'katazuku-setup-'))
const repo = fileURLToPath(new URL('..', import.meta.url))
const configFile = join(root, 'katazuku.config.json')
const credentials = join(root, 'fake-credentials')
const env: NodeJS.ProcessEnv = { PATH: '', KATAZUKU_CHATGPT_DIR: join(root, 'fake-chatgpt') }
const commands = { claude: join(root, 'claude.exe'), codex: join(root, 'codex.exe'), 'codex-oss': join(root, 'codex.exe') }
const options = { env, commands }
let count = 0
const check = (label: string, condition: boolean) => { assert(condition, label); console.log('[ok] ' + label); count++ }
const missing = (checks: Awaited<ReturnType<typeof inspectSetup>>, name: string) => checks.some((entry) => entry.name === name && entry.status === 'missing')
const base = () => ({
  profile: { displayName: '利用者A（架空）', timezone: 'Asia/Tokyo', signature: ['利用者A（架空）'] },
  google: { accounts: [{ id: 'main', email: 'you@example.test', primary: true }], credentialsDir: credentials },
  agent: { providerOrder: ['codex-cli'] },
})
const save = (value: unknown) => writeFileSync(configFile, JSON.stringify(value))
const inspect = () => inspectSetup(root, options)
try {
  mkdirSync(join(root, 'schemas'))
  copyFileSync(join(repo, 'schemas', 'katazuku-config.schema.json'), join(root, 'schemas', 'katazuku-config.schema.json'))
  check('設定なしは実利用可能と扱わない', missing(await inspect(), '個人設定'))
  copyFileSync(join(repo, 'katazuku.config.example.json'), configFile)
  let result = await inspect()
  check('雛形の呼び名と署名を拒否する', missing(result, '個人設定'))
  check('雛形のGoogleアカウントを拒否する', missing(result, 'Google対象アカウント'))
  save({ ...base(), privateFixture: 'never-print-this' })
  check('スキーマ違反を拒否し、例外の個人値を表示しない', missing(await inspect(), '個人設定') && !formatSetupChecks(await inspect()).includes('never-print-this'))
  writeFileSync(configFile, '{broken private-fixture}')
  check('壊れたJSONを安全に説明する', missing(await inspect(), '個人設定') && !formatSetupChecks(await inspect()).includes('private-fixture'))
  save(base())
  check('Google資格情報の不足を検知する', missing(await inspect(), 'Google資格情報'))
  mkdirSync(credentials)
  const tokenFile = join(credentials, 'you@example.test.json')
  writeFileSync(tokenFile, '{broken}')
  check('壊れた資格情報を検知する', missing(await inspect(), 'Google資格情報'))
  writeFileSync(tokenFile, JSON.stringify({ refresh_token: 'fixture-refresh' }))
  check('OAuthクライアント情報不足を検知する', missing(await inspect(), 'Google資格情報'))
  env.GOOGLE_OAUTH_CLIENT_ID = 'fixture-client'
  env.GOOGLE_OAUTH_CLIENT_SECRET = 'fixture-secret'
  check('OAuthクライアント情報を環境変数で補える', !missing(await inspect(), 'Google資格情報'))
  delete env.GOOGLE_OAUTH_CLIENT_ID
  delete env.GOOGLE_OAUTH_CLIENT_SECRET
  writeFileSync(tokenFile, JSON.stringify({ refresh_token: 'fixture-refresh', client_id: 'fixture-client', client_secret: 'fixture-secret' }))
  check('MCP保存形式のOAuthクライアント情報も確認する', !missing(await inspect(), 'Google資格情報'))
  check('未導入の選択CLIを検知する', missing(await inspect(), 'AIのローカル準備'))
  writeFileSync(commands.codex, 'not executed')
  result = await inspect()
  check('CLI存在時も実認証・定期実行を確認済みと扱わない', !missing(result, 'AIのローカル準備') && result.some((entry) => entry.status === 'unverified'))
  check('Codexのツール工程はプロジェクトMCP設定も必要', missing(result, 'Codex Google MCP設定'))
  mkdirSync(join(root, '.codex'))
  writeFileSync(join(root, '.codex', 'config.toml'), '[mcp_servers.google-workspace]\ncommand = "fixture-not-executed"\n')
  check('Codex能力判定と同じMCP設定を検出する', !missing(await inspect(), 'Codex Google MCP設定'))
  const output = formatSetupChecks(result)
  check('email・パス・呼び名・秘密値を出力しない', ['you@example.test', root, '利用者A', 'fixture-refresh', 'fixture-client', 'fixture-secret'].every((value) => !output.includes(value)))
  save({ ...base(), agent: { providerOrder: ['unknown-fixture-provider'] } })
  result = await inspect()
  check('未知AIを拒否し入力文字列を出力しない', missing(result, 'AIの選択') && !formatSetupChecks(result).includes('unknown-fixture-provider'))
  save({ ...base(), agent: { providerOrder: ['openai-api'] } })
  env.OPENAI_API_KEY = 'fixture-api-key'
  check('OpenAI APIはモデル未設定を検知する', missing(await inspect(), 'AIのローカル準備'))
  env.KATAZUKU_OPENAI_MODEL = 'fixture-model'
  check('APIだけでは有効なツール工程を開始できない', missing(await inspect(), 'ツールを使う工程'))
  save({ ...base(), agent: { providerOrder: ['openai-api'] }, workflows: { mailWatch: { enabled: false }, asa: { enabled: false }, eveningBrief: { enabled: false } } })
  check('ツール不要工程のみならAPIの前提を確認できる', !missing(await inspect(), 'ツールを使う工程'))
  save({ ...base(), profile: { ...base().profile, timezone: 'Invalid/Fixture' } })
  check('不正なタイムゾーンを検知する', missing(await inspect(), 'タイムゾーン'))
  save({ ...base(), google: { ...base().google, accounts: [{ id: 'main', email: '../../you@example.test', primary: true }] } })
  check('不正なアカウントは資格情報ファイルへ進まない', missing(await inspect(), 'Google対象アカウント') && !(await inspect()).some((entry) => entry.name === 'Google資格情報'))
  save({ ...base(), agent: { providerOrder: ['chatgpt-siwc'] } })
  check('ChatGPT未サインインを検知する', missing(await inspect(), 'AIのローカル準備'))
  console.log(`setup doctor: ${count} checks passed`)
} finally {
  rmSync(root, { recursive: true, force: true })
}
