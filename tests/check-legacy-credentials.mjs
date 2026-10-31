/** 旧DBの平文資格情報を、値を出さずDPAPI境界へ移してから列削除できることを確認する。 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openDb } from '../src/db.js'
import { migrateLegacyCompanyCredential } from '../scripts/local-login/migrate-db-credential.mjs'

const fixture = mkdtempSync(join(tmpdir(), 'katazuku-legacy-credential-'))
const repo = join(fixture, 'repo')
const dbPath = join(fixture, 'legacy.db')
const portalId = 'synthetic-portal'
let checks = 0
const ok = (condition, label) => { assert(condition, label); checks++; console.log('[ok] ' + label) }

function makeLegacyDatabase() {
  const current = openDb(dbPath)
  current.close()
  const db = new DatabaseSync(dbPath)
  db.exec("ALTER TABLE company ADD COLUMN login_id TEXT NOT NULL DEFAULT ''; ALTER TABLE company ADD COLUMN password TEXT NOT NULL DEFAULT ''; PRAGMA user_version = 6")
  const row = db.prepare(`INSERT INTO company (name, short_name, industry, mypage_url, memo, updated_at, login_id, password)
    VALUES ('合成会社', '合成会社', '', '', '', '2099-01-01T00:00:00Z', 'synthetic-user', 'synthetic-password')`).run()
  db.close()
  return Number(row.lastInsertRowid)
}

try {
  mkdirSync(join(repo, 'scripts', 'local-login'), { recursive: true })
  mkdirSync(join(repo, 'logs'), { recursive: true })
  writeFileSync(join(repo, 'scripts', 'local-login', 'portals.json'), JSON.stringify({ portals: {} }))
  writeFileSync(join(repo, 'scripts', 'local-login', 'portal-presets.json'), JSON.stringify({ version: 1, presets: [] }))
  writeFileSync(join(repo, 'logs', 'local-login-portals.local.json'), JSON.stringify({
    portals: { [portalId]: { label: '合成ポータル', loginUrl: 'https://login.example.test/team/start', authMode: 'password' } },
  }))
  const companyId = makeLegacyDatabase()

  assert.throws(() => openDb(dbPath), /平文資格情報/)
  checks++; console.log('[ok] v7 migrationは平文資格情報を値なしで拒否する')
  ok(!readdirSync(fixture).some((name) => name.includes('.before-v7-')), '平文が残る拒否時は追加バックアップも作らない')
  const afterRefusal = new DatabaseSync(dbPath)
  ok(afterRefusal.prepare('PRAGMA user_version').get().user_version === 6, '拒否時はschema versionを進めない')
  ok(afterRefusal.prepare('SELECT login_id, password FROM company WHERE id = ?').get(companyId).password === 'synthetic-password', '拒否時は旧資格情報を変更しない')
  afterRefusal.close()

  await assert.rejects(() => migrateLegacyCompanyCredential({
    databasePath: resolve(dbPath), repositoryRoot: repo, companyId, portalId,
    async storeCredential() { throw new Error('synthetic store failure') },
  }), /synthetic store failure/)
  checks++; console.log('[ok] broker保存失敗を成功扱いしない')
  const afterFailure = new DatabaseSync(dbPath)
  ok(afterFailure.prepare('SELECT password FROM company WHERE id = ?').get(companyId).password === 'synthetic-password', 'broker失敗時はDB平文を消さない')
  afterFailure.close()

  let observed = null
  const result = await migrateLegacyCompanyCredential({
    databasePath: resolve(dbPath), repositoryRoot: repo, companyId, portalId,
    async storeCredential(input) {
      observed = { username: input.username, password: input.password, portalId: input.portalId }
      writeFileSync(input.outputPath, JSON.stringify({
        version: 1, portalId: input.portalId, allowedOrigin: 'https://login.example.test',
        usernameCiphertext: 'encrypted-user', passwordCiphertext: 'encrypted-password', protectedFor: 'CurrentUser',
      }))
    },
  })
  ok(result.status === 'migrated' && result.credentialStored, 'broker保存成功後だけ移行済みを返す')
  ok(observed?.username === 'synthetic-user' && observed?.password === 'synthetic-password', '移行process内だけ旧値をbrokerへ渡す')
  const records = readFileSync(join(repo, 'credential-store', `${portalId}.json`), 'utf8')
  ok(!records.includes('synthetic-user') && !records.includes('synthetic-password'), 'broker recordへ平文を残さない')
  const cleared = new DatabaseSync(dbPath)
  const clearedRow = cleared.prepare('SELECT login_id, password FROM company WHERE id = ?').get(companyId)
  ok(clearedRow.login_id === '' && clearedRow.password === '', 'broker保存と同じ処理で旧DB平文を空にする')
  cleared.close()

  const migrated = openDb(dbPath)
  const columns = migrated.prepare('PRAGMA table_info(company)').all().map((column) => column.name)
  ok(!columns.includes('login_id') && !columns.includes('password'), '全件退避後のv7 migrationで平文列を削除する')
  ok(migrated.prepare('PRAGMA user_version').get().user_version === 7, '資格情報分離後にschema v7へ進む')
  migrated.close()

  await assert.rejects(() => migrateLegacyCompanyCredential({
    databasePath: resolve(dbPath), repositoryRoot: repo, companyId, portalId,
  }), /既にあります/)
  checks++; console.log('[ok] 既存DPAPI recordを黙って上書きしない')
  console.log(`${checks}件の旧資格情報移行チェックを通過`)
} finally {
  rmSync(fixture, { recursive: true, force: true })
}
