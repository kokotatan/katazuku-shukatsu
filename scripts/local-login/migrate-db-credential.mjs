/**
 * 旧company.login_id/passwordを、値を表示せずWindows DPAPI recordへ1件ずつ移す。
 * v7 migrationは平文が残るDBを拒否するため、その前に明示実行する退避専用入口。
 */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, link, mkdir, readFile, rm } from 'node:fs/promises'
import { isAbsolute, dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { credentialRecordPath, readRegistry } from './settings.mjs'
import { validatePortalId } from './lib.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const storeScript = fileURLToPath(new URL('./store-credential.ps1', import.meta.url))

function parseArgs(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!['--database', '--company-id', '--portal'].includes(key) || value == null) throw new Error('使い方を確認してください')
    result[key.slice(2)] = value
  }
  if (Object.keys(result).length !== 3) throw new Error('使い方を確認してください')
  return result
}

async function runStore({ portalId, loginUrl, outputPath, username, password }) {
  if (process.platform !== 'win32') throw new Error('DPAPI移行はWindowsだけに対応しています')
  await access(storeScript)
  const args = [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', storeScript,
    '-PortalId', portalId, '-AllowedUrl', loginUrl, '-OutputPath', outputPath, '-ReadFromStdin',
  ]
  const child = spawn('powershell.exe', args, { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { if (stdout.length < 8_192) stdout += chunk })
  child.stderr.on('data', (chunk) => { if (stderr.length < 8_192) stderr += chunk })
  const code = new Promise((accept, reject) => {
    child.once('error', reject)
    child.once('close', accept)
  })
  child.stdin.end(`${username}\n${password}\n`, 'utf8')
  if (await code !== 0) throw new Error('DPAPI資格情報を保存できませんでした')
  let result
  try { result = JSON.parse(stdout.trim()) } catch { throw new Error('DPAPI保存結果を検証できませんでした') }
  if (result.status !== 'stored' || result.portalId !== portalId || stderr.trim()) throw new Error('DPAPI保存結果を検証できませんでした')
}

export async function migrateLegacyCompanyCredential({
  databasePath,
  repositoryRoot = root,
  companyId,
  portalId,
  storeCredential = runStore,
}) {
  if (!isAbsolute(databasePath)) throw new Error('databaseは絶対パスで指定してください')
  if (!Number.isInteger(companyId) || companyId < 1) throw new Error('company-idが不正です')
  validatePortalId(portalId)
  const registry = await readRegistry(repositoryRoot)
  const portal = registry[portalId]
  if (!portal || portal.authMode !== 'password') throw new Error('password方式の登録済みportalを指定してください')
  const finalPath = credentialRecordPath(repositoryRoot, portalId, portal)
  try {
    await access(finalPath)
    throw new Error('このportalにはDPAPI資格情報が既にあります。上書きせず、本人が対応関係を確認してください')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  const db = new DatabaseSync(resolve(databasePath))
  let username = ''
  let password = ''
  let stagingPath = ''
  let finalCreated = false
  try {
    const version = (db.prepare('PRAGMA user_version').get()).user_version
    if (!Number.isInteger(version) || version > 6) throw new Error('旧v6以下のDBだけを移行できます')
    const columns = db.prepare('PRAGMA table_info(company)').all().map((column) => column.name)
    if (!columns.includes('login_id') || !columns.includes('password')) throw new Error('旧資格情報列がありません')
    const row = db.prepare('SELECT login_id, password FROM company WHERE id = ?').get(companyId)
    if (!row) throw new Error('company-idが見つかりません')
    username = String(row.login_id || '')
    password = String(row.password || '')
    if (!username || !password) throw new Error('移行対象のログインIDまたはパスワードが空です')

    await mkdir(dirname(finalPath), { recursive: true })
    stagingPath = `${finalPath}.${randomUUID()}.migrating`
    await storeCredential({ portalId, loginUrl: portal.loginUrl, outputPath: stagingPath, username, password })
    const encrypted = await readFile(stagingPath, 'utf8')
    if (encrypted.includes(username) || encrypted.includes(password)) throw new Error('DPAPI recordへ平文が残っています')

    db.exec('BEGIN IMMEDIATE')
    try {
      const changed = db.prepare(`UPDATE company SET login_id = '', password = ''
        WHERE id = ? AND login_id = ? AND password = ?`).run(companyId, username, password)
      if (Number(changed.changes) !== 1) throw new Error('移行中に旧資格情報が変更されました')
      await link(stagingPath, finalPath)
      finalCreated = true
      db.exec('COMMIT')
    } catch (error) {
      try { db.exec('ROLLBACK') } catch {}
      if (finalCreated) await rm(finalPath, { force: true })
      throw error
    }
    return { status: 'migrated', companyId, portalId, credentialStored: true }
  } finally {
    username = ''
    password = ''
    if (stagingPath) await rm(stagingPath, { force: true })
    db.close()
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const databasePath = args.database
  if (!isAbsolute(databasePath)) throw new Error('databaseは絶対パスで指定してください')
  const result = await migrateLegacyCompanyCredential({
    databasePath,
    companyId: Number(args['company-id']),
    portalId: args.portal,
  })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    const message = error && !error.code && /^(使い方|database|company-id|旧|password方式|DPAPI|このportal|移行対象)/.test(error.message)
      ? error.message
      : '旧資格情報を安全に移行できませんでした。設定とbrokerを確認してください。'
    process.stderr.write(`${JSON.stringify({ status: 'error', message })}\n`)
    process.exitCode = 1
  })
}
