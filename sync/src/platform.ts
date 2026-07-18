/**
 * DB正本へ人物・プロフィール・メール・面接・提出・カレンダー・企業研究を集約する。
 * 写真本体はDB/スナップショットへ入れず、person_photo.storage_keyだけを保持する。
 */
import { DatabaseSync } from 'node:sqlite'

function addColumn(db: DatabaseSync, table: string, name: string, definition: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!cols.some((column) => column.name === name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`)
  }
}

export function ensurePlatformSchema(db: DatabaseSync): void {
  addColumn(db, 'appointment', 'external_id', "TEXT NOT NULL DEFAULT ''")
  addColumn(db, 'appointment', 'calendar_id', "TEXT NOT NULL DEFAULT ''")
  addColumn(db, 'appointment', 'source_hash', "TEXT NOT NULL DEFAULT ''")

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_appointment_external
      ON appointment(external_id) WHERE external_id <> '';

    CREATE TABLE IF NOT EXISTS profile_basic (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL DEFAULT 'agent'
    );

    CREATE TABLE IF NOT EXISTS profile_suggestion (
      id INTEGER PRIMARY KEY,
      field TEXT NOT NULL,
      value TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.5,
      status TEXT NOT NULL DEFAULT '候補',
      created_at TEXT NOT NULL,
      UNIQUE(field, value, source_ref)
    );

    CREATE TABLE IF NOT EXISTS person (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      company_id INTEGER REFERENCES company(id),
      company_text TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      met_at TEXT NOT NULL DEFAULT '',
      how_met TEXT NOT NULL DEFAULT '',
      follow_up TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      UNIQUE(name, company_text)
    );

    CREATE TABLE IF NOT EXISTS person_note (
      id INTEGER PRIMARY KEY,
      person_id INTEGER NOT NULL REFERENCES person(id),
      at TEXT NOT NULL,
      note TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1,
      UNIQUE(person_id, note, source_ref)
    );

    CREATE TABLE IF NOT EXISTS person_photo (
      person_id INTEGER PRIMARY KEY REFERENCES person(id),
      storage_key TEXT NOT NULL UNIQUE,
      sha256 TEXT NOT NULL,
      verified_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS appointment_person (
      appointment_id INTEGER NOT NULL REFERENCES appointment(id),
      person_id INTEGER NOT NULL REFERENCES person(id),
      role TEXT NOT NULL DEFAULT '',
      PRIMARY KEY(appointment_id, person_id)
    );

    CREATE TABLE IF NOT EXISTS meeting_run (
      id TEXT PRIMARY KEY,
      appointment_id INTEGER NOT NULL UNIQUE REFERENCES appointment(id),
      state TEXT NOT NULL DEFAULT 'armed',
      opened_at TEXT NOT NULL DEFAULT '',
      recording_started_at TEXT NOT NULL DEFAULT '',
      ended_at TEXT NOT NULL DEFAULT '',
      digest_applied_at TEXT NOT NULL DEFAULT '',
      last_error TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS interview_note (
      id INTEGER PRIMARY KEY,
      appointment_id INTEGER REFERENCES appointment(id),
      selection_id INTEGER REFERENCES selection(id),
      company_id INTEGER REFERENCES company(id),
      occurred_at TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      transcript_path TEXT NOT NULL DEFAULT '',
      source_ref TEXT NOT NULL UNIQUE,
      data_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS submission (
      id INTEGER PRIMARY KEY,
      selection_id INTEGER NOT NULL REFERENCES selection(id),
      kind TEXT NOT NULL,
      submitted_at TEXT NOT NULL,
      result TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      source_ref TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS company_dossier (
      company_id INTEGER PRIMARY KEY REFERENCES company(id),
      summary TEXT NOT NULL DEFAULT '',
      facts_json TEXT NOT NULL DEFAULT '{}',
      sources_json TEXT NOT NULL DEFAULT '[]',
      researched_at TEXT NOT NULL,
      source_ref TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS mail_item (
      id TEXT PRIMARY KEY,
      selection_id INTEGER REFERENCES selection(id),
      company_id INTEGER REFERENCES company(id),
      received_at TEXT NOT NULL,
      sender TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'その他',
      needs_action INTEGER NOT NULL DEFAULT 0,
      deadline TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '未確認',
      source_ref TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_person_company ON person(company_id);
    CREATE INDEX IF NOT EXISTS idx_person_note_person ON person_note(person_id);
    CREATE INDEX IF NOT EXISTS idx_interview_selection ON interview_note(selection_id);
    CREATE INDEX IF NOT EXISTS idx_submission_selection ON submission(selection_id);
    CREATE INDEX IF NOT EXISTS idx_mail_received ON mail_item(received_at DESC);
  `)
}

function parseJson(value: unknown, fallback: unknown): unknown {
  try {
    return JSON.parse(String(value || ''))
  } catch {
    return fallback
  }
}

function stripImages(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripImages)
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' && value.startsWith('data:image/') ? '' : value
  }
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/photo|image|picture/i.test(key) && !/Key$/.test(key)) continue
    result[key] = stripImages(child)
  }
  return result
}

export interface PlatformSnapshot {
  profile: unknown
  profileSuggestions: Record<string, unknown>[]
  people: Record<string, unknown>[]
  personNotes: Record<string, unknown>[]
  interviews: Record<string, unknown>[]
  submissions: Record<string, unknown>[]
  dossiers: Record<string, unknown>[]
  meetingRuns: Record<string, unknown>[]
  mailItems: Record<string, unknown>[]
  enrichedEvents: Record<string, unknown>[]
}

export function listPlatformSnapshot(db: DatabaseSync): PlatformSnapshot {
  const profileRow = db.prepare('SELECT data_json FROM profile_basic WHERE id = 1').get() as { data_json?: string } | undefined
  const profile = stripImages(parseJson(profileRow?.data_json, {}))

  const profileSuggestions = db.prepare(`
    SELECT id, field, value, source_ref AS sourceRef, confidence, status, created_at AS createdAt
    FROM profile_suggestion ORDER BY created_at DESC
  `).all() as Record<string, unknown>[]

  const people = db.prepare(`
    SELECT p.id, p.name, p.company_text AS company, p.role, p.category,
           p.met_at AS metAt, p.how_met AS howMet, p.follow_up AS followUp,
           p.updated_at AS updatedAt, c.name AS officialCompany,
           pp.storage_key AS photoKey, pp.verified_at AS photoVerifiedAt
    FROM person p
    LEFT JOIN company c ON c.id = p.company_id
    LEFT JOIN person_photo pp ON pp.person_id = p.id
    ORDER BY p.updated_at DESC, p.id DESC
  `).all() as Record<string, unknown>[]

  const personNotes = db.prepare(`
    SELECT pn.id, pn.person_id AS personId, p.name AS personName, pn.at,
           pn.note, pn.source_ref AS sourceRef, pn.confidence
    FROM person_note pn JOIN person p ON p.id = pn.person_id
    ORDER BY pn.at DESC, pn.id DESC
  `).all() as Record<string, unknown>[]

  const interviews = (db.prepare(`
    SELECT i.id, i.appointment_id AS appointmentId, i.selection_id AS selectionId,
           i.occurred_at AS occurredAt, i.title, i.summary, i.source_ref AS sourceRef,
           i.data_json AS dataJson, c.name AS company
    FROM interview_note i LEFT JOIN company c ON c.id = i.company_id
    ORDER BY i.occurred_at DESC, i.id DESC
  `).all() as Record<string, unknown>[]).map((row) => {
    const { dataJson, ...rest } = row
    return { ...rest, detail: parseJson(dataJson, {}) }
  })

  const submissions = db.prepare(`
    SELECT s.id, s.selection_id AS selectionId, c.name AS company, se.position,
           s.kind, s.submitted_at AS submittedAt, s.result, s.detail,
           s.source_ref AS sourceRef
    FROM submission s
    JOIN selection se ON se.id = s.selection_id
    JOIN company c ON c.id = se.company_id
    ORDER BY s.submitted_at DESC, s.id DESC
  `).all() as Record<string, unknown>[]

  const dossiers = (db.prepare(`
    SELECT d.company_id AS companyId, c.name AS company, d.summary,
           d.facts_json AS factsJson, d.sources_json AS sourcesJson,
           d.researched_at AS researchedAt, d.source_ref AS sourceRef
    FROM company_dossier d JOIN company c ON c.id = d.company_id
    ORDER BY d.researched_at DESC
  `).all() as Record<string, unknown>[]).map((row) => {
    const { factsJson, sourcesJson, ...rest } = row
    return { ...rest, facts: parseJson(factsJson, {}), sources: parseJson(sourcesJson, []) }
  })

  const meetingRuns = db.prepare(`
    SELECT mr.id, mr.appointment_id AS appointmentId, mr.state,
           mr.opened_at AS openedAt, mr.recording_started_at AS recordingStartedAt,
           mr.ended_at AS endedAt, mr.digest_applied_at AS digestAppliedAt,
           mr.last_error AS lastError, mr.updated_at AS updatedAt
    FROM meeting_run mr ORDER BY mr.updated_at DESC
  `).all() as Record<string, unknown>[]

  const mailItems = db.prepare(`
    SELECT m.id, m.selection_id AS selectionId, m.received_at AS receivedAt,
           m.sender, m.subject, m.summary, m.category, m.needs_action AS needsAction,
           m.deadline, m.status, m.source_ref AS sourceRef, c.name AS company
    FROM mail_item m LEFT JOIN company c ON c.id = m.company_id
    ORDER BY m.received_at DESC LIMIT 200
  `).all() as Record<string, unknown>[]

  const enrichedEvents = db.prepare(`
    SELECT e.id, e.selection_id AS selectionId, e.at, e.kind, e.summary,
           e.source, e.ref, c.name AS company, s.position
    FROM event e
    JOIN selection s ON s.id = e.selection_id
    JOIN company c ON c.id = s.company_id
    ORDER BY e.at DESC, e.id DESC LIMIT 200
  `).all() as Record<string, unknown>[]

  return {
    profile,
    profileSuggestions,
    people,
    personNotes,
    interviews,
    submissions,
    dossiers,
    meetingRuns,
    mailItems,
    enrichedEvents,
  }
}
