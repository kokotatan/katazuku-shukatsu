/** 緊急フェイルオーバー候補DBを一切変更せず検査する。 */
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'

const path = process.argv[2]
if (!path) throw new Error('usage: db-failover-check.ts <database-path>')

const db = new DatabaseSync(resolve(path), { readOnly: true })
try {
  const integrity = (db.prepare('PRAGMA integrity_check').get() as { integrity_check?: string } | undefined)
    ?.integrity_check || 'unknown'
  if (integrity !== 'ok') throw new Error(`integrity_check=${integrity}`)
  const identity = db.prepare('SELECT database_id AS databaseId FROM database_identity WHERE id = 1')
    .get() as { databaseId?: string } | undefined
  if (!identity?.databaseId) throw new Error('database_identityがありません')
  const count = (table: string) => Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n)
  const scalar = (sql: string) => String((db.prepare(sql).get() as { value?: string } | undefined)?.value || '')
  console.log(JSON.stringify({
    ok: true,
    path: resolve(path),
    databaseId: identity.databaseId,
    schemaVersion: Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version),
    companies: count('company'),
    selections: count('selection'),
    appointments: count('appointment'),
    events: count('event'),
    latestCompanyUpdate: scalar("SELECT MAX(updated_at) AS value FROM company"),
    latestSelectionUpdate: scalar("SELECT MAX(updated_at) AS value FROM selection"),
  }))
} finally {
  db.close()
}
