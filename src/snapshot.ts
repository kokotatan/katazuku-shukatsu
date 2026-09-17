import type { DatabaseSync } from 'node:sqlite'
import { listSelections, listAppointments, listCompanies, listEvents, listPending, outcomeOf } from './db.js'
import { listPlatformSnapshot } from './platform.js'
import { SNAPSHOT_VERSION, stripSnapshotSecrets, validateSnapshot } from './snapshot-contract.js'
import { readConsistentSnapshot } from './database-maintenance.js'

/** 書き込みを行わず、現在の正本だけから閲覧用データを作る。 */
export function buildSnapshot(db: DatabaseSync): Record<string, unknown> {
  return readConsistentSnapshot(db, () => buildSnapshotAtCurrentVersion(db))
}

function buildSnapshotAtCurrentVersion(db: DatabaseSync): Record<string, unknown> {
  const selections = listSelections(db)
  const platform = listPlatformSnapshot(db)
  const snapshot = stripSnapshotSecrets({
    schemaVersion: SNAPSHOT_VERSION,
    generatedAt: new Date().toISOString(),
    companies: listCompanies(db).map(company => ({ name: company.name, shortName: company.shortName ?? '',
      industry: company.industry, mypageUrl: company.mypageUrl, memo: company.memo })),
    selections: selections.map(selection => ({ ...selection, outcome: outcomeOf(selection.status) })),
    appointments: listAppointments(db),
    events: listEvents(db),
    ...platform,
    // event台帳を活動ログへ複製すると、同じ操作が二重になる。独立した作業メモは別入力で扱う。
    activities: [],
    pending: listPending(db).map(item => ({ name: item.name, context: item.context, createdAt: item.created_at })),
  })
  validateSnapshot(snapshot)
  return snapshot
}
