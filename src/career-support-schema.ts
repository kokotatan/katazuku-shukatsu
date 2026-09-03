import type { DatabaseSync } from 'node:sqlite'

function addColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

/** 応募先企業とは別に、就活支援組織とその面談を保持するスキーマ。 */
export function ensureCareerSupportSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS career_organization (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      short_name TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'other'
        CHECK (kind IN ('career_agent','event_organizer','recruiting_media','university','other')),
      website TEXT NOT NULL DEFAULT '',
      memo TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS career_organization_alias (
      alias_norm TEXT PRIMARY KEY,
      alias TEXT NOT NULL,
      organization_id INTEGER NOT NULL REFERENCES career_organization(id),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS career_meeting (
      id INTEGER PRIMARY KEY,
      organization_id INTEGER REFERENCES career_organization(id),
      external_id TEXT NOT NULL,
      calendar_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT '面談',
      url TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'review'
        CHECK (status IN ('review','scheduled','completed','cancelled')),
      recordable INTEGER NOT NULL DEFAULT 1 CHECK (recordable IN (0,1)),
      source_hash TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(calendar_id, external_id)
    );
    CREATE TABLE IF NOT EXISTS career_meeting_run (
      id TEXT PRIMARY KEY,
      career_meeting_id INTEGER NOT NULL UNIQUE REFERENCES career_meeting(id),
      state TEXT NOT NULL DEFAULT 'armed',
      opened_at TEXT NOT NULL DEFAULT '',
      recording_started_at TEXT NOT NULL DEFAULT '',
      ended_at TEXT NOT NULL DEFAULT '',
      digest_applied_at TEXT NOT NULL DEFAULT '',
      last_error TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_career_meeting_time ON career_meeting(start_at, status, recordable);
  `)
  // 既存の人物・議事録表示を再利用しつつ、応募企業のcompany_idは捏造しない。
  addColumn(db, 'interview_note', 'organization_id', 'INTEGER REFERENCES career_organization(id)')
  addColumn(db, 'interview_note', 'career_meeting_id', 'INTEGER REFERENCES career_meeting(id)')
  addColumn(db, 'person', 'organization_id', 'INTEGER REFERENCES career_organization(id)')
}
