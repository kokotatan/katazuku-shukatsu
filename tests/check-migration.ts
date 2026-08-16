/**
 * スキーマ版とマイグレーションのチェック(#10)。
 *
 * 「どこまで適用済みか」を user_version 1つで決めていること、破壊的な版の前に
 * スナップショットが残ること、未来の版のDBを古いコードで開かないことを確かめる。
 *   npm run test:migration
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openDb, SCHEMA_VERSION, upsertCompany, listCompanies } from '../src/db.js'

let failed = 0
function check(label: string, cond: boolean, detail = '') {
  console.log(`${cond ? '[ok]' : '[FAIL]'} ${label}${cond ? '' : ` — ${detail}`}`)
  if (!cond) failed++
}

const userVersion = (db: DatabaseSync) =>
  (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version

// --- 新規DB ---
const fresh = openDb(':memory:')
check('新規DBは現行の版が刻まれる', userVersion(fresh) === SCHEMA_VERSION, `${userVersion(fresh)} ≠ ${SCHEMA_VERSION}`)
check('SCHEMA_VERSION は正の整数', Number.isInteger(SCHEMA_VERSION) && SCHEMA_VERSION > 0)

// --- ファイルDB: 破壊的な版の前にスナップショットが残る ---
const dir = mkdtempSync(join(tmpdir(), 'katazuku-migration-'))
const path = join(dir, 'katazuku.db')
const first = openDb(path)
upsertCompany(first, { name: '株式会社サンプルA' })
first.close()
check('破壊的な版の適用前スナップショットが残る', existsSync(`${path}.v1.bak`))

// --- 再オープンで再適用しない ---
const reopened = openDb(path)
check('再オープンしても版は変わらない', userVersion(reopened) === SCHEMA_VERSION)
check('再オープンでデータが消えない', listCompanies(reopened).some((c) => c.name === '株式会社サンプルA'))
rmSync(`${path}.v1.bak`, { force: true })
reopened.close()
const third = openDb(path)
check('適用済みの版はスナップショットを取り直さない(=再実行していない)', !existsSync(`${path}.v1.bak`))
third.close()

// --- 未来の版のDBは開かない ---
const futurePath = join(dir, 'future.db')
const future = openDb(futurePath)
future.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 5}`)
future.close()
check('未来の版のDBは開かずに落とす(古いコードで壊さない)', (() => {
  try {
    openDb(futurePath).close()
    return false
  } catch (error) {
    return error instanceof Error && error.message.includes(`v${SCHEMA_VERSION + 5}`)
  }
})())

// 後片付け(掴んだままのハンドルが残っていれば消せない = 上のチェックで検出済み)
try { rmSync(dir, { recursive: true, force: true }) } catch { /* 一時ディレクトリなので放置してよい */ }

if (failed) { console.error(`\n${failed}件失敗`); process.exit(1) }
console.log('\nすべて通過')
