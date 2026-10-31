/**
 * init-db: 個人データを入れずに、正本SQLiteのファイルと現行スキーマを用意する。
 *
 *   npm run init                 # OSの利用者別データ領域に作成
 *   npm run init -- ./custom.db  # 保存先を明示
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb, SCHEMA_VERSION } from '../src/db.js'
import { resolveDatabasePath } from '../src/data-path.js'

export interface InitializeDatabaseResult {
  path: string
  existed: boolean
  schemaVersion: number
}

export function initializeDatabase(explicitPath?: string): InitializeDatabaseResult {
  const path = resolveDatabasePath(explicitPath)
  if (path === ':memory:') {
    throw new Error('正本DBには永続ファイルを指定してください。:memory: はデモとテスト専用です。')
  }

  const existed = existsSync(path)
  const db = openDb(path)
  const schemaVersion = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  db.close()

  if (schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`スキーマ初期化に失敗しました: v${schemaVersion} (期待値: v${SCHEMA_VERSION})`)
  }
  return { path, existed, schemaVersion }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isMain) {
  const result = initializeDatabase(process.argv[2])
  console.log(result.existed ? '正本DBを確認・更新しました。' : '空の正本DBを作成しました。')
  console.log(`  path   : ${result.path}`)
  console.log(`  schema : v${result.schemaVersion}`)
  console.log('個人データはまだ入っていません。実データの書き込みはエージェントへ依頼してください。')
}
