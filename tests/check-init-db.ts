import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { initializeDatabase } from '../scripts/init-db.js'
import { SCHEMA_VERSION } from '../src/db.js'
import { resolveDatabasePath } from '../src/data-path.js'

const root = mkdtempSync(join(tmpdir(), 'katazuku-init-db-'))
const path = join(root, 'nested', 'katazuku.db')
let failures = 0

function check(name: string, ok: boolean): void {
  if (ok) console.log(`ok - ${name}`)
  else { console.error(`not ok - ${name}`); failures += 1 }
}

try {
  check('Windowsの既定保存先はソースツリー外の利用者別領域',
    resolveDatabasePath(undefined, { LOCALAPPDATA: join(root, 'local') }, 'win32') === join(root, 'local', 'katazuku', 'data', 'katazuku.db'))
  check('明示した保存先を最優先する', resolveDatabasePath(path, { KATAZUKU_DB: join(root, 'other.db') }, 'win32') === path)
  const created = initializeDatabase(path)
  check('初回は正本DBを新規作成する', !created.existed && existsSync(path))
  check('空の新規DBには不要な移行前スナップショットを作らない', !existsSync(`${path}.v1.bak`))
  check('現行のスキーマ版を適用する', created.schemaVersion === SCHEMA_VERSION)

  const db = new DatabaseSync(path, { readOnly: true })
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
  const companies = db.prepare('SELECT COUNT(*) AS count FROM company').get() as { count: number }
  db.close()
  check('正本の主要テーブルを作成する', tables.some((table) => table.name === 'selection'))
  check('初期化ではデモ企業を入れない', companies.count === 0)

  const reopened = initializeDatabase(path)
  check('再実行しても同じDBを安全に開ける', reopened.existed && reopened.schemaVersion === SCHEMA_VERSION)
} finally {
  rmSync(root, { recursive: true, force: true })
}

if (failures) process.exit(1)
console.log('init-db tests passed')
