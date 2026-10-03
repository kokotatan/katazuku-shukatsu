/** 公開CLIの試し実行が合成DB・ログ・状態を変更しないことを、一時リポジトリで確認する。 */
import { strict as assert } from 'node:assert'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { addAppointment, openDb } from '../src/db.js'
import { applyDiff } from '../src/db-apply.js'
import { WORKFLOW_NAMES } from '../src/katazuku-config.js'
import { localDate } from '../scripts/brief-data.js'

const repo = fileURLToPath(new URL('..', import.meta.url))
const fixture = mkdtempSync(join(tmpdir(), 'katazuku-dry-run-'))
const dependencies = join(fixture, 'node_modules')
const database = join(fixture, 'data', 'synthetic.db')
const config = join(fixture, 'katazuku.config.json')
const old = new Date('2000-01-01T00:00:00Z')
let checks = 0
function check(label: string, condition: boolean) { assert(condition, label); checks++; console.log('[ok] ' + label) }
function snapshot(ignoreSqliteAuxiliary = false): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  function visit(path: string): void {
    const entry = statSync(path)
    const name = relative(fixture, path)
    if (ignoreSqliteAuxiliary && [database + '-shm', database + '-wal'].includes(path)) return
    if (entry.isDirectory()) {
      result[name] = 'directory'
      for (const child of readdirSync(path).sort()) visit(join(path, child))
    } else result[name] = { digest: createHash('sha256').update(readFileSync(path)).digest('hex'), modified: entry.mtimeMs }
  }
  for (const name of readdirSync(fixture).sort()) {
    if (!['src', 'scripts', 'schemas', 'node_modules', 'package.json'].includes(name)) visit(join(fixture, name))
  }
  return result
}
function run(workflow: string, dryRun = true, dbPath = database) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^KATAZUKU_/i.test(key)))
  return spawnSync(process.execPath, [join(dependencies, 'tsx', 'dist', 'cli.mjs'), 'scripts/workflow.ts', workflow, ...(dryRun ? ['--dry-run'] : [])], {
    cwd: fixture, windowsHide: true, encoding: 'utf8', timeout: 20_000,
    env: { ...env, KATAZUKU_CONFIG: config, KATAZUKU_DB: dbPath, KATAZUKU_CHATGPT_DIR: join(fixture, 'chatgpt') },
  })
}
function unchanged(workflow: string, status = 0, dbPath = database, ignoreSqliteAuxiliary = false): void {
  const before = snapshot(ignoreSqliteAuxiliary)
  const result = run(workflow, true, dbPath)
  check(workflow + ': 試し実行が期待どおり終了する', result.status === status && !result.error)
  check(workflow + ': DB・ログ・状態の内容と更新時刻を保持する', JSON.stringify(snapshot(ignoreSqliteAuxiliary)) === JSON.stringify(before))
  if (status === 0) {
    const marker = workflow === 'watchdog' ? '[dry-run] 番犬:' : workflow === 'calendar-sync' ? '[dry-run] calendar-sync:'
      : workflow === 'evening-brief' && !existsSync(dbPath) ? '正本DBがまだ無いため' : '[dry-run] workflow=' + workflow
    check(workflow + ': 実際に試し実行の分岐へ到達する', result.stdout.includes(marker))
  }
}
function expired(path: string, content = '合成ログ\n'): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
  utimesSync(path, old, old)
}
try {
  for (const name of ['src', 'scripts', 'schemas']) cpSync(join(repo, name), join(fixture, name), { recursive: true })
  cpSync(join(repo, 'package.json'), join(fixture, 'package.json'))
  symlinkSync(join(repo, 'node_modules'), dependencies, process.platform === 'win32' ? 'junction' : 'dir')
  writeFileSync(config, JSON.stringify({ notify: { desktop: false, selfEmail: false } }))
  for (const workflow of WORKFLOW_NAMES) unchanged(workflow)
  check('初回の試し実行はログ用ディレクトリや空DBを作らない', !existsSync(join(fixture, 'logs')) && !existsSync(database))
  const firstNormal = run('watchdog', false)
  check('初回の通常実行はログ用ディレクトリを作って実行できる', firstNormal.status === 0 && existsSync(join(fixture, 'logs', 'watchdog-heartbeat.txt')))
  check('通常の番犬は活動ログを残しロックを解放する', existsSync(join(fixture, 'logs', 'activity-log.jsonl')) && !existsSync(join(fixture, 'logs', 'watchdog.lock')))

  for (const workflow of WORKFLOW_NAMES) expired(join(fixture, 'logs', workflow + '-20000101.log'))
  expired(join(fixture, 'logs', 'agent-runs', 'old-run.local.json'))
  expired(join(fixture, 'logs', 'agent-runs', 'provider-health.local.json'), '{}')
  expired(join(fixture, 'logs', 'briefs', 'old.local.md'))
  expired(join(fixture, 'logs', 'watchdog-heartbeat.txt'))
  expired(join(fixture, 'logs', 'watchdog-summary.local.txt'))
  expired(join(fixture, 'logs', 'watchdog-last.local.txt'))
  expired(join(fixture, 'logs', 'alert-asa.txt'))
  const db = openDb(database)
  applyDiff(db, [{ name: '会社A', stage: 'intern', position: '架空の選考' }])
  const selection = db.prepare('SELECT id FROM selection').get() as { id: number }
  for (const days of [1, 2]) addAppointment(db, { selectionId: selection.id, at: localDate('Asia/Tokyo', days) + 'T12:00:00+09:00', kind: '面接', title: '架空の面接' })
  db.exec('PRAGMA journal_mode = DELETE')
  db.close()
  for (const workflow of WORKFLOW_NAMES) unchanged(workflow)

  const legacy = new DatabaseSync(database)
  legacy.exec('PRAGMA user_version = 1')
  legacy.close()
  unchanged('evening-brief')
  const version = new DatabaseSync(database, { readOnly: true })
  check('試し実行は旧DBをマイグレーションしない', (version.prepare('PRAGMA user_version').get() as { user_version: number }).user_version === 1)
  version.close()

  const oldSchemaPath = join(fixture, 'data', 'old-schema.db')
  const oldSchema = new DatabaseSync(oldSchemaPath)
  oldSchema.exec('CREATE TABLE company (id INTEGER PRIMARY KEY, name TEXT); PRAGMA user_version = 1')
  oldSchema.close()
  unchanged('evening-brief', 1, oldSchemaPath) // 読み取れない旧スキーマを変更して直さない。

  const writer = new DatabaseSync(database)
  try {
    writer.exec('PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0')
    writer.exec("UPDATE appointment SET title = '架空のWAL予定'")
    const before = snapshot(true)
    const walRead = run('evening-brief')
    check('WAL内の最新予定を試し実行で読み取る', walRead.status === 0 && walRead.stdout.includes('架空のWAL予定'))
    check('WALを読む試し実行はDB本体・ログ・状態を保持する', JSON.stringify(snapshot(true)) === JSON.stringify(before))
    check('WALを読む試し実行もuser_versionを変更しない', (writer.prepare('PRAGMA user_version').get() as { user_version: number }).user_version === 1)
  } finally { writer.close() }

  const normal = run('watchdog', false) // ローカルの番犬だけ。AI・Google・デスクトップ通知は呼ばない。
  check('通常の番犬は引き続き実行できる', normal.status === 0 && !normal.error)
  check('通常実行は古いログとブリーフを整理する', !existsSync(join(fixture, 'logs', 'watchdog-20000101.log'))
    && !existsSync(join(fixture, 'logs', 'agent-runs', 'old-run.local.json')) && !existsSync(join(fixture, 'logs', 'briefs', 'old.local.md')))
  check('通常実行のログ整理はproviderの状態を保持する', existsSync(join(fixture, 'logs', 'agent-runs', 'provider-health.local.json')))
  console.log(`${checks}件の試し実行チェックを通過`)
} finally {
  // junction/symlinkを先に取り除き、元リポジトリの依存へ再帰しない。
  try { lstatSync(dependencies); unlinkSync(dependencies) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  assert(dirname(resolve(fixture)) === resolve(tmpdir()) && basename(fixture).startsWith('katazuku-dry-run-'))
  rmSync(fixture, { recursive: true, force: true })
}
