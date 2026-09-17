/** 長期蓄積・移行失敗・WALを含む退避を、個人版とOSS版で同じ条件で検証する。 */
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { openDb, SCHEMA_VERSION, listEvents } from '../src/db.js'
import { assertDatabaseIntegrity, createDatabaseBackup, databaseVersion, migrateDatabase, readConsistentSnapshot, verifyDatabaseBackup } from '../src/database-maintenance.js'

const root = mkdtempSync(join(tmpdir(), 'katazuku-durability-'))
const handles = new Set<DatabaseSync>()
const track = (db: DatabaseSync) => { handles.add(db); return db }
const close = (db: DatabaseSync) => { db.close(); handles.delete(db) }
const checksum = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
const count = (db: DatabaseSync, table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
function check(label: string, run: () => void) { run(); console.log(`[ok] ${label}`) }

function legacy(path: string, duplicate = false): void {
  const db = track(new DatabaseSync(path))
  db.exec(`CREATE TABLE company (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, official_name TEXT NOT NULL DEFAULT '',
    industry TEXT NOT NULL DEFAULT '', mypage_url TEXT NOT NULL DEFAULT '',
    login_id TEXT NOT NULL DEFAULT '', password TEXT NOT NULL DEFAULT '', memo TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  );`)
  db.prepare('INSERT INTO company (name, official_name, updated_at) VALUES (?, ?, ?)').run('Example A', 'Example Official A', '2020-01-01')
  if (duplicate) db.prepare('INSERT INTO company (name, official_name, updated_at) VALUES (?, ?, ?)').run('Example B', 'Example Official A', '2020-01-01')
  close(db)
}

try {
  check('未来の版は、テーブルやjournal_modeを一切変更せず拒否する', () => {
    const path = join(root, 'future.db')
    const db = track(new DatabaseSync(path))
    db.exec(`CREATE TABLE future_only (id INTEGER PRIMARY KEY); PRAGMA user_version = ${SCHEMA_VERSION + 1}`)
    close(db)
    const before = checksum(path)
    assert.throws(() => openDb(path), /アプリを更新/)
    assert.equal(checksum(path), before)
    assert.ok(!existsSync(`${path}-wal`))
  })

  check('旧版のデータを退避して移行し、再オープンでは移行を繰り返さない', () => {
    const path = join(root, 'legacy.db')
    legacy(path)
    const db = track(openDb(path))
    assert.equal(databaseVersion(db), SCHEMA_VERSION)
    assert.equal(db.prepare('SELECT name FROM company').get()?.name, 'Example Official A')
    assert.equal(db.prepare('SELECT short_name FROM company').get()?.short_name, 'Example A')
    close(db)
    const backups = readdirSync(root).filter(name => name.startsWith('legacy.db.before-'))
    assert.equal(backups.length, 1)
    const original = track(new DatabaseSync(join(root, backups[0]!), { readOnly: true }))
    assert.equal(original.prepare('SELECT name FROM company').get()?.name, 'Example A')
    assert.equal(databaseVersion(original), 0)
    assertDatabaseIntegrity(original)
    close(original)
    const again = track(openDb(path))
    assert.equal(again.prepare('SELECT name FROM company').get()?.name, 'Example Official A')
    close(again)
    assert.deepEqual(readdirSync(root).filter(name => name.startsWith('legacy.db.before-')), backups)
  })

  check('移行途中の失敗は列追加・データ更新・版番号を戻し、再試行でも前の退避を残す', () => {
    const path = join(root, 'failure.db')
    legacy(path, true)
    for (let attempt = 0; attempt < 2; attempt++) {
      assert.throws(() => openDb(path), /UNIQUE/)
      const db = track(new DatabaseSync(path, { readOnly: true }))
      assert.equal(databaseVersion(db), 0)
      assert.equal(count(db, 'company'), 2)
      assert.ok(!(db.prepare('PRAGMA table_info(company)').all() as { name: string }[]).some(row => row.name === 'short_name'))
      assert.equal(db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'selection'").get(), undefined)
      close(db)
    }
    const backups = readdirSync(root).filter(name => name.startsWith('failure.db.before-'))
    assert.equal(backups.length, 2)
    for (const file of backups) verifyDatabaseBackup(join(root, file))
  })

  check('バックアップを作れなければ移行を始めない', () => {
    const path = join(root, 'backup-unavailable.db')
    legacy(path)
    const db = track(new DatabaseSync(path))
    db.exec('PRAGMA journal_mode = WAL')
    let changed = false
    assert.throws(() => migrateDatabase(db, join(root, 'missing', 'db'), SCHEMA_VERSION, () => { changed = true }))
    assert.equal(changed, false)
    assert.equal(databaseVersion(db), 0)
    close(db)
  })

  const walPath = join(root, 'wal.db')
  const writer = track(openDb(walPath))
  writer.exec('PRAGMA wal_autocheckpoint = 0; PRAGMA wal_checkpoint(TRUNCATE)')
  writer.prepare('INSERT INTO company (name, short_name, updated_at) VALUES (?, ?, ?)').run('Example WAL', 'Example WAL', '2020-01-01')
  writer.exec("INSERT INTO selection (company_id, updated_at) VALUES (1, '2020-01-01')")
  writer.exec("INSERT INTO event (selection_id, at, kind, summary) VALUES (1, '2020-01-01', '記録', 'Example WAL commit')")

  check('WALだけにある確定済みの更新を、単独で復元できるバックアップへ含める', () => {
    assert.ok(statSync(`${walPath}-wal`).size > 0)
    const unsafePath = join(root, 'copy-only.db')
    copyFileSync(walPath, unsafePath)
    const unsafe = track(new DatabaseSync(unsafePath, { readOnly: true }))
    assert.equal(count(unsafe, 'event'), 0, 'WALにしかない更新を使った試験であること')
    close(unsafe)
    const backup = createDatabaseBackup(writer, join(root, 'verified.db'))
    verifyDatabaseBackup(backup)
    const restoredPath = join(root, 'restored.db')
    copyFileSync(backup, restoredPath)
    const restored = track(openDb(restoredPath))
    assert.equal(count(restored, 'company'), 1)
    assert.equal(count(restored, 'selection'), 1)
    assert.equal(count(restored, 'event'), 1)
    assert.equal(restored.prepare('SELECT summary FROM event').get()?.summary, 'Example WAL commit')
    assertDatabaseIntegrity(restored)
    close(restored)
    const before = checksum(backup)
    assert.throws(() => createDatabaseBackup(writer, backup), /既に存在/)
    assert.equal(checksum(backup), before)
  })

  check('複数テーブルの読取途中に別接続が更新しても、時点を混在させない', () => {
    const reader = track(new DatabaseSync(walPath, { readOnly: true }))
    readConsistentSnapshot(reader, () => {
      assert.equal(count(reader, 'event'), 1)
      writer.exec("INSERT INTO event (selection_id, at, kind, summary) VALUES (1, '2020-01-02', '記録', 'Example concurrent commit')")
      assert.equal(count(reader, 'event'), 1)
    })
    assert.equal(count(reader, 'event'), 2)
    assert.throws(() => readConsistentSnapshot(reader, () => { throw new Error('Example read failure') }), /read failure/)
    assert.equal(readConsistentSnapshot(reader, () => count(reader, 'event')), 2)
    close(reader)
  })
  close(writer)

  check('参照先の欠落やファイル破損がある退避は、成功扱いせず途中ファイルも残さない', () => {
    const invalid = track(new DatabaseSync(':memory:'))
    invalid.exec('PRAGMA foreign_keys = OFF; CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE child(parent_id INTEGER REFERENCES parent(id)); INSERT INTO child VALUES (999)')
    assert.throws(() => assertDatabaseIntegrity(invalid), /参照先/)
    const target = join(root, 'invalid.db')
    assert.throws(() => createDatabaseBackup(invalid, target), /参照先/)
    assert.ok(!existsSync(target))
    assert.ok(!readdirSync(root).some(name => name.endsWith('.partial')))
    close(invalid)
    writeFileSync(target, 'Example corrupted backup')
    assert.throws(() => verifyDatabaseBackup(target))
  })

  check('10万件の履歴でも検索に索引を使い、最新100件をSQL側で取得する', () => {
    const db = track(openDb(':memory:'))
    db.exec("INSERT INTO company (id, name, short_name, updated_at) VALUES (1, 'Example Scale', 'Example Scale', '2020-01-01')")
    db.exec("INSERT INTO selection (id, company_id, updated_at) VALUES (1, 1, '2020-01-01'), (2, 1, '2020-01-01')")
    const insert = db.prepare('INSERT INTO event (selection_id, at, kind, summary, source, ref) VALUES (?, ?, ?, ?, ?, ?)')
    db.exec('BEGIN')
    for (let i = 0; i < 100_000; i++) {
      insert.run(i % 2 + 1, new Date(Date.UTC(2020, 0, 1) + i * 3_600_000).toISOString(), '記録', `Example ${i}`, 'fixture', `example-${i}`)
    }
    db.exec('COMMIT; ANALYZE')
    const cases = [
      ["SELECT id FROM event WHERE ref = 'example-99999' AND kind = '記録' AND selection_id = 2", 'idx_event_ref_kind_selection'],
      ['SELECT id FROM event WHERE selection_id = 2 ORDER BY id DESC LIMIT 100', 'idx_event_selection_id'],
      ["SELECT id FROM event WHERE at >= '2026-01-01' AND at < '2026-02-01' ORDER BY at DESC, id DESC LIMIT 100", 'idx_event_at_id'],
    ]
    for (const [query, index] of cases) {
      const plan = db.prepare(`EXPLAIN QUERY PLAN ${query}`).all() as { detail: string }[]
      assert.ok(plan.some(row => row.detail.includes('SEARCH') && row.detail.includes(index!)), JSON.stringify(plan))
      assert.ok(!plan.some(row => /TEMP B-TREE/.test(row.detail)))
    }
    const start = performance.now()
    const recent = listEvents(db, undefined, 100)
    const perSelection = listEvents(db, 2, 100)
    console.log(`10万件中の最新100件と選考別100件: ${(performance.now() - start).toFixed(2)} ms`)
    assert.equal(recent.length, 100)
    assert.equal(recent[0]?.summary, 'Example 99900')
    assert.equal(recent[99]?.summary, 'Example 99999')
    assert.equal(perSelection.length, 100)
    assert.ok(perSelection.every(row => row.selection_id === 2))
    assert.equal(count(db, 'event'), 100_000)
    assert.throws(() => listEvents(db, undefined, 0))
    assertDatabaseIntegrity(db)
    close(db)
  })
  console.log('データ耐久性: 8項目通過。検証データは一時領域のみ。')
} finally {
  for (const db of handles) { try { db.close() } catch { /* 既に閉じた接続は無視。 */ } }
  const absolute = resolve(root)
  const temp = resolve(tmpdir())
  if (!absolute.startsWith(temp + '\\') && !absolute.startsWith(temp + '/')) throw new Error('検証用ディレクトリ外の削除を拒否しました')
  rmSync(absolute, { recursive: true, force: true })
}
