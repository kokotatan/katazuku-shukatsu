/**
 * DB正本へ人物・プロフィール・メール・面接・提出・カレンダー・企業研究・移動を集約する。
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

    -- 就活予定を「時刻が空いているか」ではなく「実際に移動して参加できるか」で扱う。
    -- 住所は個人性が高いためDBローカルだけに置き、snapshotへは出さない。
    CREATE TABLE IF NOT EXISTS place (
      id INTEGER PRIMARY KEY,
      place_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'other'
        CHECK (kind IN ('home', 'campus', 'station', 'office', 'hotel', 'coworking', 'other')),
      company_id INTEGER REFERENCES company(id),
      address TEXT NOT NULL DEFAULT '',
      latitude REAL,
      longitude REAL,
      timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo',
      provider TEXT NOT NULL DEFAULT '',
      external_id TEXT NOT NULL DEFAULT '',
      privacy TEXT NOT NULL DEFAULT 'private'
        CHECK (privacy IN ('private', 'shared', 'public')),
      source_ref TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mobility_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      home_place_id INTEGER REFERENCES place(id),
      campus_place_id INTEGER REFERENCES place(id),
      online_before_minutes INTEGER NOT NULL DEFAULT 15 CHECK (online_before_minutes >= 0),
      online_after_minutes INTEGER NOT NULL DEFAULT 15 CHECK (online_after_minutes >= 0),
      in_person_before_minutes INTEGER NOT NULL DEFAULT 30 CHECK (in_person_before_minutes >= 0),
      in_person_after_minutes INTEGER NOT NULL DEFAULT 30 CHECK (in_person_after_minutes >= 0),
      max_in_person_per_day INTEGER NOT NULL DEFAULT 2 CHECK (max_in_person_per_day >= 0),
      allow_online_in_transit INTEGER NOT NULL DEFAULT 0 CHECK (allow_online_in_transit IN (0, 1)),
      timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo',
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL DEFAULT 'agent'
    );

    CREATE TABLE IF NOT EXISTS appointment_mobility (
      appointment_id INTEGER PRIMARY KEY REFERENCES appointment(id),
      attendance_mode TEXT NOT NULL DEFAULT 'unknown'
        CHECK (attendance_mode IN ('online', 'in_person', 'hybrid', 'unknown')),
      place_id INTEGER REFERENCES place(id),
      arrival_buffer_minutes INTEGER CHECK (arrival_buffer_minutes IS NULL OR arrival_buffer_minutes >= 0),
      departure_buffer_minutes INTEGER CHECK (departure_buffer_minutes IS NULL OR departure_buffer_minutes >= 0),
      remote_setup_minutes INTEGER CHECK (remote_setup_minutes IS NULL OR remote_setup_minutes >= 0),
      mobility_status TEXT NOT NULL DEFAULT 'unreviewed'
        CHECK (mobility_status IN ('unreviewed', 'feasible', 'tight', 'infeasible', 'confirmed')),
      decision_reason TEXT NOT NULL DEFAULT '',
      source_ref TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

    -- 具体的な切符を取る前の所要時間見積もり。manualから経路APIへ差し替えられる。
    CREATE TABLE IF NOT EXISTS route_estimate (
      id INTEGER PRIMARY KEY,
      from_place_id INTEGER NOT NULL REFERENCES place(id),
      to_place_id INTEGER NOT NULL REFERENCES place(id),
      transport_mode TEXT NOT NULL DEFAULT 'public_transit'
        CHECK (transport_mode IN ('walk', 'public_transit', 'rail', 'flight', 'car', 'taxi', 'other')),
      duration_minutes INTEGER NOT NULL CHECK (duration_minutes >= 0),
      buffer_minutes INTEGER NOT NULL DEFAULT 0 CHECK (buffer_minutes >= 0),
      provider TEXT NOT NULL DEFAULT 'manual',
      source_ref TEXT NOT NULL DEFAULT '',
      valid_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

    -- 日時確定後の具体的な移動。前後の予定と結び、カレンダーにも独立ブロックとして出せる。
    CREATE TABLE IF NOT EXISTS travel_segment (
      id INTEGER PRIMARY KEY,
      from_appointment_id INTEGER REFERENCES appointment(id),
      to_appointment_id INTEGER REFERENCES appointment(id),
      from_place_id INTEGER NOT NULL REFERENCES place(id),
      to_place_id INTEGER NOT NULL REFERENCES place(id),
      depart_at TEXT NOT NULL,
      arrive_at TEXT NOT NULL,
      transport_mode TEXT NOT NULL DEFAULT 'public_transit'
        CHECK (transport_mode IN ('walk', 'public_transit', 'rail', 'flight', 'car', 'taxi', 'other')),
      provider TEXT NOT NULL DEFAULT '',
      route_ref TEXT NOT NULL DEFAULT '',
      duration_minutes INTEGER NOT NULL CHECK (duration_minutes >= 0),
      buffer_minutes INTEGER NOT NULL DEFAULT 0 CHECK (buffer_minutes >= 0),
      status TEXT NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned', 'reserved', 'ticketed', 'completed', 'cancelled')),
      cost_amount INTEGER CHECK (cost_amount IS NULL OR cost_amount >= 0),
      currency TEXT NOT NULL DEFAULT 'JPY',
      reimbursable INTEGER NOT NULL DEFAULT 0 CHECK (reimbursable IN (0, 1)),
      calendar_external_id TEXT NOT NULL DEFAULT '',
      source_ref TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_place_provider_external
      ON place(provider, external_id) WHERE provider <> '' AND external_id <> '';
    CREATE INDEX IF NOT EXISTS idx_place_company ON place(company_id);
    CREATE INDEX IF NOT EXISTS idx_appointment_mobility_place ON appointment_mobility(place_id);
    CREATE INDEX IF NOT EXISTS idx_route_estimate_pair
      ON route_estimate(from_place_id, to_place_id, transport_mode, updated_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_route_estimate_source
      ON route_estimate(source_ref) WHERE source_ref <> '';
    CREATE INDEX IF NOT EXISTS idx_travel_segment_time ON travel_segment(depart_at, arrive_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_travel_segment_source
      ON travel_segment(source_ref) WHERE source_ref <> '';
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
