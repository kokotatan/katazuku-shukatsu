import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  createGoogleWorkspaceConfig,
  parseDesktopOAuthCredentials,
  readGoogleWorkspaceConfig,
  resolveGoogleWorkspaceConfigPath,
  writeGoogleWorkspaceConfig,
} from '../src/google-workspace-config.js'

let failures = 0
function check(name: string, condition: boolean): void {
  if (condition) console.log(`ok - ${name}`)
  else { console.error(`not ok - ${name}`); failures += 1 }
}

function expectThrow(name: string, fn: () => unknown, pattern: RegExp): void {
  try { fn(); check(name, false) }
  catch (error) { check(name, error instanceof Error && pattern.test(error.message)) }
}

const clientId = `123-${'a'.repeat(32)}.${['apps', 'googleusercontent', 'com'].join('.')}`
const clientSecret = 'synthetic-oauth-secret'
const work = await mkdtemp(join(tmpdir(), 'katazuku-google-'))
const configPath = join(work, 'config', 'google-workspace.json')

try {
  const oauth = parseDesktopOAuthCredentials({ installed: { client_id: clientId, client_secret: clientSecret } })
  check('デスクトップOAuthクライアントJSONを解釈する', oauth.clientId === clientId && oauth.clientSecret === clientSecret)
  expectThrow('ウェブアプリ用クライアントを拒否する', () => parseDesktopOAuthCredentials({ web: {} }), /デスクトップ/)

  const config = createGoogleWorkspaceConfig({ ...oauth, accountEmail: 'you@example.com' })
  await writeGoogleWorkspaceConfig(config, { path: configPath })
  const loaded = await readGoogleWorkspaceConfig(configPath)
  check('利用者別設定をリポジトリ外の指定先へ保存・再読込する', loaded.accountEmail === 'you@example.com' && loaded.oauthClientId === clientId)

  let refusedOverwrite = false
  try { await writeGoogleWorkspaceConfig(config, { path: configPath }) } catch { refusedOverwrite = true }
  check('明示指定なしの設定上書きを拒否する', refusedOverwrite)

  const windowsPath = resolveGoogleWorkspaceConfigPath({ LOCALAPPDATA: join(work, 'local') }, 'win32', work)
  const linuxPath = resolveGoogleWorkspaceConfigPath({ XDG_CONFIG_HOME: join(work, 'xdg') }, 'linux', work)
  check('OSごとにソースツリー外のユーザー設定パスを使う', windowsPath.includes('katazuku-shukatsu') && linuxPath.includes('katazuku-shukatsu'))

  const credentialPath = join(work, 'desktop-client.json')
  const cliConfigPath = join(work, 'cli', 'google-workspace.json')
  await writeFile(credentialPath, JSON.stringify({ installed: { client_id: clientId, client_secret: clientSecret } }))
  const setup = spawnSync(process.execPath, [resolve('tools/setup-google-workspace.mjs'), '--credentials', credentialPath, '--email', 'you@example.com'], {
    encoding: 'utf8',
    env: { ...process.env, KATAZUKU_GOOGLE_CONFIG: cliConfigPath },
  })
  const setupOutput = `${setup.stdout}${setup.stderr}`
  check('セットアップCLIが利用者別設定を作成する', setup.status === 0 && JSON.parse(await readFile(cliConfigPath, 'utf8')).accountEmail === 'you@example.com')
  check('セットアップCLIの出力へOAuth値を漏らさない', !setupOutput.includes(clientId) && !setupOutput.includes(clientSecret) && !setupOutput.includes('you@example.com'))

  const bridge = spawnSync(process.execPath, [resolve('tools/google-workspace-mcp.mjs'), '--check-config'], {
    encoding: 'utf8',
    env: { ...process.env, KATAZUKU_GOOGLE_CONFIG: cliConfigPath },
  })
  check('MCPブリッジが秘密を表示せず設定を検証する', bridge.status === 0 && !`${bridge.stdout}${bridge.stderr}`.includes(clientSecret))
} finally {
  await rm(work, { recursive: true, force: true })
}

if (failures) process.exit(1)
console.log('google-workspace setup tests passed')
