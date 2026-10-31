import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { configurePortal } from './configure-portal.mjs'
import { credentialCommand } from './register-credential.mjs'

const parent = resolve('logs')
await mkdir(parent, { recursive: true })
const root = await mkdtemp(join(parent, 'local-login-configure-check-'))
try {
  await mkdir(join(root, 'scripts', 'local-login'), { recursive: true })
  await writeFile(join(root, 'scripts', 'local-login', 'portal-presets.json'), JSON.stringify({ version: 1, presets: [] }))
  await writeFile(join(root, 'scripts', 'local-login', 'portals.json'), JSON.stringify({ portals: {} }))
  const added = await configurePortal({ root, id: 'example', label: '合成サービス', loginUrl: 'https://login.example.test/team/start', authMode: 'password' })
  assert.equal(added.reauthenticationRequired, true)
  assert.match(added.credentialPath, /example-[a-f0-9-]{36}\.json$/)
  const saved = JSON.parse(await readFile(join(root, 'logs', 'local-login-portals.local.json'), 'utf8'))
  assert.equal(saved.portals.example.loginUrl, 'https://login.example.test/team/start')
  assert.equal(saved.portals.example.authMode, 'password')
  const [executable, credentialArgs] = await credentialCommand('example', root)
  assert.equal(executable, 'powershell.exe')
  assert.equal(credentialArgs.includes('-NonInteractive'), false)
  assert.equal(credentialArgs.includes('fixture-password'), false)
  assert.equal(credentialArgs[credentialArgs.indexOf('-AllowedUrl') + 1], 'https://login.example.test/team/start')
  await assert.rejects(() => configurePortal({ root, id: 'example', label: '合成サービス', loginUrl: 'https://other.example.test/', authMode: 'password' }), /登録済み/)
  await assert.rejects(() => configurePortal({ root, id: 'bad', label: '合成サービス', loginUrl: 'https://' + 'user:secret' + '@example.test/', authMode: 'password' }), /認証情報/)
  const replaced = await configurePortal({ root, id: 'example', label: '合成サービス', loginUrl: 'https://other.example.test/login', authMode: 'sso', replace: true })
  assert.notEqual(replaced.credentialPath, added.credentialPath)
  console.log('自動ログインCLI設定: 追加・重複拒否・URL検査・世代分離を確認')
} finally {
  const target = resolve(root)
  if (!target.startsWith(parent + sep) || !target.split(sep).at(-1).startsWith('local-login-configure-check-')) throw new Error('試験フォルダの範囲が不正です')
  await rm(target, { recursive: true, force: true })
}
