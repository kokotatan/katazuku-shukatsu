/** DBの更新と退避。復元できることを確認したファイルだけをバックアップとして残す。 */
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export function databaseVersion(db: DatabaseSync): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
}

/** 未知の版には、テーブル作成やjournal_modeの変更より先に止まる。 */
export function assertSupportedDatabase(db: DatabaseSync, supportedVersion: number): void {
  const version = databaseVersion(db)
  if (version > supportedVersion) {
    throw new Error(`このDBはスキーマ v${version} です。対応するのは v${supportedVersion} までです。アプリを更新してください。`)
  }
}

/** integrity_checkは参照先の欠落を調べないため、foreign_key_checkも必ず併用する。 */
export function assertDatabaseIntegrity(db: DatabaseSync): void {
  const result = db.prepare('PRAGMA integrity_check').get() as { integrity_check?: string } | undefined
  if (result?.integrity_check !== 'ok') throw new Error('DBの整合性を確認できません。保存・同期を止め、バックアップからの復旧を確認してください。')
  if (db.prepare('PRAGMA foreign_key_check').get()) {
    throw new Error('DBに参照先のない記録があります。保存・同期を止め、バックアップからの復旧を確認してください。')
  }
}

export function verifyDatabaseBackup(path: string): void {
  const db = new DatabaseSync(path, { readOnly: true })
  try { assertDatabaseIntegrity(db) } finally { db.close() }
}

/**
 * WALに残るコミットもSQLite自身に取り込ませる。稼働中DBのファイルコピーは使わない。
 * 途中のファイルは別名に置き、検査・ディスク同期後に既存を上書きせず公開する。
 */
export function createDatabaseBackup(db: DatabaseSync, destination: string): string {
  const target = resolve(destination)
  if (existsSync(target)) throw new Error('指定されたバックアップは既に存在します。上書きせず別の保存先を選んでください。')
  mkdirSync(dirname(target), { recursive: true })
  const temporary = `${target}.${randomUUID()}.partial`
  try {
    db.prepare('VACUUM INTO ?').run(temporary)
    verifyDatabaseBackup(temporary)
    const fd = openSync(temporary, 'r+')
    try { fsyncSync(fd) } finally { closeSync(fd) }
    linkSync(temporary, target)
    return target
  } finally {
    rmSync(temporary, { force: true })
  }
}

/**
 * 版の判定・スキーマ変更・版の記録を一つのトランザクションにする。
 * 別プロセスの更新を止めてから別の読取接続で退避し、退避と更新の間の書込みも防ぐ。
 * 失敗しても以前のバックアップを削除しない。新規の空DBには不要な退避を作らない。
 */
export function migrateDatabase(
  db: DatabaseSync,
  path: string,
  targetVersion: number,
  upgrade: (fromVersion: number) => void,
): void {
  assertSupportedDatabase(db, targetVersion)
  if (databaseVersion(db) === targetVersion) return
  db.exec('BEGIN IMMEDIATE')
  try {
    // 他のプロセスの移行が先に終わっていた場合も、ロック取得後の版で判定する。
    assertSupportedDatabase(db, targetVersion)
    const fromVersion = databaseVersion(db)
    if (fromVersion !== targetVersion) {
      const hasTables = Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1").get())
      if (path !== ':memory:' && hasTables) {
        const backupPath = `${path}.before-v${targetVersion}-${Date.now()}-${randomUUID()}.db`
        const reader = new DatabaseSync(path, { readOnly: true })
        try { createDatabaseBackup(reader, backupPath) } finally { reader.close() }
      }
      upgrade(fromVersion)
      assertDatabaseIntegrity(db)
      db.exec(`PRAGMA user_version = ${targetVersion}`)
    }
    db.exec('COMMIT')
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* 元のエラーを返す。 */ }
    throw error
  }
}

/** 書込み中でも、複数テーブルを同じ時点の内容として読む。既存トランザクションにも対応。 */
export function readConsistentSnapshot<T>(db: DatabaseSync, read: () => T): T {
  const savepoint = `snapshot_${randomUUID().replaceAll('-', '')}`
  db.exec(`SAVEPOINT ${savepoint}`)
  try {
    const result = read()
    db.exec(`RELEASE ${savepoint}`)
    return result
  } catch (error) {
    db.exec(`ROLLBACK TO ${savepoint}`)
    db.exec(`RELEASE ${savepoint}`)
    throw error
  }
}

/** 長期蓄積する履歴の参照、重複照合、予定と企業の関連付けに使う索引。 */
export function ensureCoreIndexes(db: DatabaseSync): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_selection_company_season ON selection(company_id, season);
    CREATE INDEX IF NOT EXISTS idx_company_alias_company ON company_alias(company_id);
    CREATE INDEX IF NOT EXISTS idx_pending_review_resolved_name ON pending_review(resolved, name);
    CREATE INDEX IF NOT EXISTS idx_event_selection_id ON event(selection_id, id);
    CREATE INDEX IF NOT EXISTS idx_event_at_id ON event(at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_event_ref_kind_selection ON event(ref, kind, selection_id);
    CREATE INDEX IF NOT EXISTS idx_appointment_selection_at ON appointment(selection_id, at);
    CREATE INDEX IF NOT EXISTS idx_appointment_at_id ON appointment(at, id);
  `)
}
