/**
 * 自動運転ワークフロー(mail-watch / daily-sync / asa / evening-brief / calendar-sync)が使う表。
 * スキーマ v4 として版管理下で作る(src/db.ts の MIGRATIONS)。
 *
 * - submission_requirement: 企業・大学などから求められた提出物を「成果物1件ずつ」追う台帳。
 *   メールが既読・処理済みになっても、completed / waived になるまで消えない。
 * - schedule_block: 空き判定専用の予定投影。大学・私用・終日予定も会社を捏造せずに保持する。
 * - source_sync_state: 外部取得(カレンダー等)をどのアカウントのどの期間まで正常に取れたか。
 *   鮮度と期間被覆を満たさない限り、空き判定は unknown を返す(情報不足を空きと誤認しない)。
 * - appointment.flexible: 固定予定と重なったら動かしてよい本人タスク(空き判定では占有しない)。
 */
import type { DatabaseSync } from 'node:sqlite'

function addColumn(db: DatabaseSync, table: string, name: string, definition: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!cols.some((column) => column.name === name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`)
  }
}

export function ensureWorkflowSchema(db: DatabaseSync): void {
  addColumn(db, 'appointment', 'flexible', 'INTEGER NOT NULL DEFAULT 0')
  db.exec(`
    CREATE TABLE IF NOT EXISTS submission_requirement (
      id INTEGER PRIMARY KEY,
      logical_key TEXT NOT NULL UNIQUE,
      selection_id INTEGER REFERENCES selection(id),
      company_id INTEGER REFERENCES company(id),
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      deadline TEXT NOT NULL DEFAULT '',
      action_url TEXT NOT NULL DEFAULT '',
      instructions TEXT NOT NULL DEFAULT '',
      source_ref TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'required'
        CHECK (status IN ('required', 'completed', 'waived')),
      preparation_status TEXT NOT NULL DEFAULT 'not_started'
        CHECK (preparation_status IN ('not_started', 'researching', 'ready_for_approval', 'blocked', 'done')),
      preparation_ref TEXT NOT NULL DEFAULT '',
      blocker TEXT NOT NULL DEFAULT '',
      completion_ref TEXT NOT NULL DEFAULT '',
      first_seen_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_submission_requirement_open
      ON submission_requirement(status, deadline, preparation_status);
    CREATE INDEX IF NOT EXISTS idx_submission_requirement_company
      ON submission_requirement(company_id, selection_id, kind);

    CREATE TABLE IF NOT EXISTS source_sync_state (
      source TEXT NOT NULL,
      account_id TEXT NOT NULL DEFAULT '',
      scope_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'unknown'
        CHECK (status IN ('success', 'partial', 'failed', 'unknown')),
      covered_from TEXT NOT NULL DEFAULT '',
      covered_until TEXT NOT NULL DEFAULT '',
      last_attempt_at TEXT NOT NULL,
      last_success_at TEXT NOT NULL DEFAULT '',
      last_error TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (source, account_id, scope_id)
    );

    CREATE TABLE IF NOT EXISTS schedule_block (
      id INTEGER PRIMARY KEY,
      provider TEXT NOT NULL,
      account_id TEXT NOT NULL DEFAULT '',
      calendar_id TEXT NOT NULL DEFAULT '',
      external_id TEXT NOT NULL,
      appointment_id INTEGER REFERENCES appointment(id),
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      all_day INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1)),
      busy INTEGER NOT NULL DEFAULT 1 CHECK (busy IN (0, 1)),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
      source_hash TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      UNIQUE(provider, account_id, calendar_id, external_id)
    );
    CREATE INDEX IF NOT EXISTS idx_schedule_block_time
      ON schedule_block(start_at, end_at, status, busy);
    CREATE INDEX IF NOT EXISTS idx_schedule_block_appointment
      ON schedule_block(appointment_id) WHERE appointment_id IS NOT NULL;
  `)
}
