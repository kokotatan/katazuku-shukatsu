/**
 * スキーマ版とマイグレーションのチェック(#10)。
 *
 * 「どこまで適用済みか」を user_version 1つで決めていること、破壊的な版の前に
 * スナップショットが残ること、未来の版のDBを古いコードで開かないことを確かめる。
 *   npm run test:migration
 */
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openDb, SCHEMA_VERSION, upsertCompany, listCompanies } from '../src/db.js'
import { getDatabaseContext } from '../src/schedule.js'

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
check('v3: 就活支援組織・面談テーブルが版管理下で作られる', (() => {
  const tables = fresh.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
  return ['career_organization', 'career_meeting', 'career_meeting_run'].every((name) => tables.some((row) => row.name === name))
})())
check('v3: 議事録と人物が支援組織を参照できる', (() => {
  const interview = fresh.prepare('PRAGMA table_info(interview_note)').all() as { name: string }[]
  const person = fresh.prepare('PRAGMA table_info(person)').all() as { name: string }[]
  return interview.some((row) => row.name === 'organization_id')
    && interview.some((row) => row.name === 'career_meeting_id')
    && person.some((row) => row.name === 'organization_id')
})())
check('v6: 交通費精算と領収書タスク由来の列が版管理下にある', (() => {
  const columns = fresh.prepare('PRAGMA table_info(appointment)').all() as { name: string }[]
  return ['reimbursement_status', 'receipt_required', 'parent_appointment_id', 'task_type']
    .every((name) => columns.some((column) => column.name === name))
})())
check('v6: 正本の論理IDをDB内部に持つ', /^[a-f0-9]{32}$/.test(getDatabaseContext(fresh).databaseId))

// --- ファイルDB: 破壊的な版の前にスナップショットが残る ---
const dir = mkdtempSync(join(tmpdir(), 'katazuku-migration-'))
const path = join(dir, 'katazuku.db')
new DatabaseSync(path).close()
const first = openDb(path)
upsertCompany(first, { name: '株式会社サンプルA' })
const canonicalId = getDatabaseContext(first).databaseId
first.close()
const backupsAfterMigration = readdirSync(dir).filter((name) => name.startsWith('katazuku.db.before-v1-') && name.endsWith('.db'))
check('破壊的な版の適用前バックアップが一意名で残る', backupsAfterMigration.length === 1, backupsAfterMigration.join(', '))

// --- 再オープンで再適用しない ---
const reopened = openDb(path)
check('再オープンしても版は変わらない', userVersion(reopened) === SCHEMA_VERSION)
check('再オープンでデータが消えない', listCompanies(reopened).some((c) => c.name === '株式会社サンプルA'))
reopened.close()
const third = openDb(path)
const backupsAfterReopen = readdirSync(dir).filter((name) => name.startsWith('katazuku.db.before-v1-') && name.endsWith('.db'))
check('適用済みの版はバックアップを取り直さない(=再実行していない)', backupsAfterReopen.length === backupsAfterMigration.length)
const indexes = third.prepare("SELECT name FROM sqlite_schema WHERE type = 'index'").all() as { name: string }[]
check('履歴・予定・派生タスクの主要索引を維持する', ['idx_event_at_id', 'idx_appointment_at_id', 'idx_appointment_derived_task'].every((name) => indexes.some((row) => row.name === name)))
third.close()

// --- バックアップや移設でも同じデータ系列だと識別できる ---
const copiedPath = join(dir, 'copied.db')
copyFileSync(path, copiedPath)
const copied = openDb(copiedPath)
check('DBを別パスへ複製しても論理IDを保持する', getDatabaseContext(copied, 'replica').databaseId === canonicalId)
check('論理IDが同じでも実行時roleはreplicaにできる', getDatabaseContext(copied, 'replica').role === 'replica')
copied.close()

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
