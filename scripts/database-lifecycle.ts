#!/usr/bin/env node
/** 正本SQLiteの検証済みバックアップ、検査、新規パス復元。既存DBを置換しない。 */
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { SCHEMA_VERSION } from '../src/db.js'
import {
  assertDatabaseIntegrity,
  assertSupportedDatabase,
  createDatabaseBackup,
  databaseVersion,
  restoreDatabaseBackup,
} from '../src/database-maintenance.js'
import { resolveDatabasePath } from '../src/data-path.js'

function stamp(now = new Date()): string {
  const part = (value: number, width = 2) => String(value).padStart(width, '0')
  return `${now.getFullYear()}${part(now.getMonth() + 1)}${part(now.getDate())}-${part(now.getHours())}${part(now.getMinutes())}${part(now.getSeconds())}-${part(now.getMilliseconds(), 3)}`
}

function requireFile(path: string, label: string): string {
  const absolute = resolve(path)
  if (!existsSync(absolute)) throw new Error(`${label}が見つかりません。`)
  return absolute
}

function inspect(path: string): { status: 'verified'; schemaVersion: number } {
  const db = new DatabaseSync(requireFile(path, 'DB'), { readOnly: true })
  try {
    assertDatabaseIntegrity(db)
    assertSupportedDatabase(db, SCHEMA_VERSION)
    return { status: 'verified', schemaVersion: databaseVersion(db) }
  } finally {
    db.close()
  }
}

function backup(sourceArg?: string, destinationArg?: string): string {
  const source = requireFile(resolveDatabasePath(sourceArg), '正本DB')
  const destination = destinationArg
    ? resolve(destinationArg)
    : join(dirname(source), 'backup', `katazuku-${stamp()}.db`)
  if (source === destination) throw new Error('正本とバックアップ先は別のパスを指定してください。')
  const db = new DatabaseSync(source, { readOnly: true })
  try {
    assertDatabaseIntegrity(db)
    assertSupportedDatabase(db, SCHEMA_VERSION)
    return createDatabaseBackup(db, destination)
  } finally {
    db.close()
  }
}

function main(): void {
  const [command = 'backup', first, second] = process.argv.slice(2)
  if (command === 'backup') {
    const destination = backup(first, second)
    process.stdout.write(`${JSON.stringify({ status: 'backed_up', destination })}\n`)
    return
  }
  if (command === 'verify') {
    if (!first) throw new Error('verifyにはDBパスが必要です。')
    process.stdout.write(`${JSON.stringify(inspect(first))}\n`)
    return
  }
  if (command === 'restore') {
    if (!first || !second || !isAbsolute(first) || !isAbsolute(second)) {
      throw new Error('restoreには復元元と新規復元先の絶対パスが必要です。')
    }
    const source = requireFile(first, '復元元')
    const destination = restoreDatabaseBackup(source, second, SCHEMA_VERSION)
    process.stdout.write(`${JSON.stringify({ status: 'restored_new_file', destination, activeDatabaseChanged: false })}\n`)
    return
  }
  throw new Error('commandはbackup、verify、restoreのいずれかです。')
}

try {
  main()
} catch (error) {
  const message = error instanceof Error ? error.message : 'データ処理に失敗しました。'
  process.stderr.write(`${JSON.stringify({ status: 'error', message })}\n`)
  process.exitCode = 1
}
