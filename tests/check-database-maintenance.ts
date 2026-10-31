/** 正本DBの整合性検査・上書き禁止バックアップ・一貫読取・原子的移行を確かめる。 */
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  assertDatabaseIntegrity,
  assertSupportedDatabase,
  createDatabaseBackup,
  databaseVersion,
  migrateDatabase,
  readConsistentSnapshot,
  verifyDatabaseBackup,
} from '../src/database-maintenance.js'

let failed = 0
function check(label: string, condition: boolean, detail = ''): void {
  console.log(`${condition ? '[ok]' : '[FAIL]'} ${label}${condition ? '' : ` — ${detail}`}`)
  if (!condition) failed++
}

const dir = mkdtempSync(join(tmpdir(), 'katazuku-db-maintenance-'))
try {
  const sourcePath = join(dir, 'source.db')
  const source = new DatabaseSync(sourcePath)
  source.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE parent (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent(id));
    INSERT INTO parent (value) VALUES ('移行前データ');
    PRAGMA user_version = 1;
  `)

  check('DB版をuser_versionから読む', databaseVersion(source) === 1)
  check('対応版以下を受け入れる', (() => {
    try {
      assertSupportedDatabase(source, 1)
      return true
    } catch {
      return false
    }
  })())
  check('未知の将来版を拒否する', (() => {
    try {
      assertSupportedDatabase(source, 0)
      return false
    } catch (error) {
      return error instanceof Error && error.message.includes('v1')
    }
  })())

  const backupPath = join(dir, 'backup.db')
  check('SQLite自身で検証済みバックアップを作る', createDatabaseBackup(source, backupPath) === backupPath && existsSync(backupPath))
  check('作ったバックアップを再検査できる', (() => {
    try {
      verifyDatabaseBackup(backupPath)
      return true
    } catch {
      return false
    }
  })())
  const backup = new DatabaseSync(backupPath, { readOnly: true })
  check('WALを含む確定データがバックアップへ入る',
    (backup.prepare('SELECT value FROM parent').get() as { value: string }).value === '移行前データ')
  backup.close()
  check('既存バックアップを上書きしない', (() => {
    try {
      createDatabaseBackup(source, backupPath)
      return false
    } catch (error) {
      return error instanceof Error && error.message.includes('既に存在')
    }
  })())

  const corruptPath = join(dir, 'corrupt.db')
  writeFileSync(corruptPath, 'not sqlite', 'utf8')
  check('壊れたバックアップを正常扱いしない', (() => {
    try {
      verifyDatabaseBackup(corruptPath)
      return false
    } catch {
      return true
    }
  })())

  // SAVEPOINTの最初の読取後に別接続が書いても、同じスナップショットでは件数が変わらない。
  const reader = new DatabaseSync(sourcePath, { readOnly: true })
  const counts = readConsistentSnapshot(reader, () => {
    const before = (reader.prepare('SELECT count(*) AS n FROM parent').get() as { n: number }).n
    source.prepare("INSERT INTO parent (value) VALUES ('後から追加')").run()
    const during = (reader.prepare('SELECT count(*) AS n FROM parent').get() as { n: number }).n
    return { before, during }
  })
  check('複数読取を同じ時点に固定する', counts.before === 1 && counts.during === 1, JSON.stringify(counts))
  check('スナップショット終了後は新しい確定データが見える',
    (reader.prepare('SELECT count(*) AS n FROM parent').get() as { n: number }).n === 2)
  reader.close()
  source.close()

  const migratePath = join(dir, 'migrate.db')
  const migrating = new DatabaseSync(migratePath)
  migrating.exec("CREATE TABLE item (id INTEGER PRIMARY KEY, value TEXT NOT NULL); INSERT INTO item(value) VALUES ('保持'); PRAGMA user_version = 1")
  migrateDatabase(migrating, migratePath, 2, (fromVersion) => {
    if (fromVersion !== 1) throw new Error(`unexpected version: ${fromVersion}`)
    migrating.exec("ALTER TABLE item ADD COLUMN note TEXT NOT NULL DEFAULT ''")
  })
  check('移行を原子的に適用して版を更新する', databaseVersion(migrating) === 2)
  check('移行で既存データを保持する',
    (migrating.prepare('SELECT value FROM item').get() as { value: string }).value === '保持')
  const migrationBackups = readdirSync(dir).filter((name) => name.startsWith('migrate.db.before-v2-') && name.endsWith('.db'))
  check('移行前バックアップを一意名で残す', migrationBackups.length === 1, migrationBackups.join(', '))
  if (migrationBackups[0]) {
    const beforeMigration = new DatabaseSync(join(dir, migrationBackups[0]), { readOnly: true })
    check('移行前バックアップは旧版とデータを保持する', databaseVersion(beforeMigration) === 1
      && (beforeMigration.prepare('SELECT value FROM item').get() as { value: string }).value === '保持')
    beforeMigration.close()
  }
  migrating.close()

  const orphanPath = join(dir, 'orphan.db')
  const orphan = new DatabaseSync(orphanPath)
  orphan.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE owner (id INTEGER PRIMARY KEY);
    CREATE TABLE owned (id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES owner(id));
    INSERT INTO owned (owner_id) VALUES (999);
  `)
  check('foreign_key_checkで参照切れを検出する', (() => {
    try {
      assertDatabaseIntegrity(orphan)
      return false
    } catch (error) {
      return error instanceof Error && error.message.includes('参照先')
    }
  })())
  orphan.close()
} finally {
  rmSync(dir, { recursive: true, force: true })
}

if (failed) {
  console.error(`\n${failed}件失敗`)
  process.exit(1)
}
console.log('\nすべて通過')
