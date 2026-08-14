/**
 * エントリーから面接予定確定までを、根拠付きの1本のrunとして記録する。
 * ES本文や適性検査の問題・解答は保存しない。
 */
import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  addAppointment,
  addEvent,
  insertSelection,
  outcomeOf,
  resolveCompany,
  samePosition,
  transition,
  upsertCompany,
} from './db'
import { transaction } from './inputs'

export type ApplicationState =
  | 'started'
  | 'entry_review'
  | 'entry_submitted'
  | 'es_review'
  | 'es_submitted'
  | 'assessment_pending'
  | 'assessment_ready'
  | 'awaiting_interview'
  | 'interview_scheduled'
  | 'paused'
  | 'failed'

export type ApplicationEventType =
  | 'entry_filled'
  | 'entry_submitted'
  | 'es_filled'
  | 'es_submitted'
  | 'entry_es_submitted'
  | 'assessment_detected'
  | 'assessment_ready'
  | 'assessment_completed'
  | 'awaiting_interview'
  | 'interview_scheduled'
  | 'paused'
  | 'resumed'
  | 'failed'
  | 'note'

const APPLICATION_EVENT_TYPES = new Set<ApplicationEventType>([
  'entry_filled',
  'entry_submitted',
  'es_filled',
  'es_submitted',
  'entry_es_submitted',
  'assessment_detected',
  'assessment_ready',
  'assessment_completed',
  'awaiting_interview',
  'interview_scheduled',
  'paused',
  'resumed',
  'failed',
  'note',
])

export interface ApplicationMaterialInput {
  key: string
  question: string
  sourceRef: string
  contentHash: string
  charCount: number
  charLimit?: number
  status?: string
}

export interface AssessmentInput {
  id?: string
  testType: string
  provider?: string
  url?: string
  deadline?: string
  durationMinutes?: number
  reservationAt?: string
  allowedItems?: string[]
  environmentStatus?: string
  status?: string
  notes?: string
  sourceRef?: string
}

export interface AppointmentInput {
  at: string
  endAt?: string
  kind?: string
  title: string
  url?: string
  location?: string
  person?: string
}

export interface StartApplicationInput {
  runId?: string
  company: string
  position?: string
  season?: string
  entryUrl?: string
  materialsRef: string
  sourceRef: string
  startedAt?: string
}

export interface ApplicationEventInput {
  eventId: string
  runId: string
  type: ApplicationEventType
  at?: string
  summary?: string
  sourceRef?: string
  approvedByUser?: boolean
  materials?: ApplicationMaterialInput[]
  assessment?: AssessmentInput
  appointment?: AppointmentInput
  error?: string
}

export interface ApplicationRunRow {
  id: string
  selectionId: number
  company: string
  position: string
  state: ApplicationState
  previousState: string
  entryUrl: string
  materialsRef: string
  sourceRef: string
  lastError: string
  startedAt: string
  updatedAt: string
  completedAt: string
}

export interface CalendarOutboxRow {
  appointmentId: number
  selectionId: number
  company: string
  position: string
  at: string
  endAt: string
  kind: string
  title: string
  url: string
  location: string
  person: string
}

export interface CalendarLinkInput {
  appointmentId: number
  externalId: string
  calendarId?: string
}

export function ensureApplicationSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS application_run (
      id TEXT PRIMARY KEY,
      selection_id INTEGER NOT NULL REFERENCES selection(id),
      state TEXT NOT NULL DEFAULT 'started',
      previous_state TEXT NOT NULL DEFAULT '',
      entry_url TEXT NOT NULL DEFAULT '',
      materials_ref TEXT NOT NULL DEFAULT '',
      source_ref TEXT NOT NULL DEFAULT '',
      last_error TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT NOT NULL DEFAULT ''
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_application_run_source
      ON application_run(source_ref) WHERE source_ref <> '';
    CREATE INDEX IF NOT EXISTS idx_application_run_selection
      ON application_run(selection_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS application_event (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES application_run(id),
      at TEXT NOT NULL,
      type TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      data_json TEXT NOT NULL DEFAULT '{}',
      source_ref TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_application_event_run
      ON application_event(run_id, at);

    CREATE TABLE IF NOT EXISTS application_material (
      run_id TEXT NOT NULL REFERENCES application_run(id),
      item_key TEXT NOT NULL,
      question TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      content_sha256 TEXT NOT NULL,
      char_count INTEGER NOT NULL,
      char_limit INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ready',
      updated_at TEXT NOT NULL,
      PRIMARY KEY(run_id, item_key)
    );

    CREATE TABLE IF NOT EXISTS web_assessment (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES application_run(id),
      selection_id INTEGER NOT NULL REFERENCES selection(id),
      test_type TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      deadline TEXT NOT NULL DEFAULT '',
      duration_minutes INTEGER NOT NULL DEFAULT 0,
      reservation_at TEXT NOT NULL DEFAULT '',
      allowed_items_json TEXT NOT NULL DEFAULT '[]',
      environment_status TEXT NOT NULL DEFAULT '未確認',
      status TEXT NOT NULL DEFAULT '準備中',
      notes TEXT NOT NULL DEFAULT '',
      source_ref TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_web_assessment_source
      ON web_assessment(source_ref) WHERE source_ref <> '';
    CREATE INDEX IF NOT EXISTS idx_web_assessment_run
      ON web_assessment(run_id, updated_at DESC);
  `)
}

function assertIso(value: string, field: string): void {
  if (value && Number.isNaN(Date.parse(value))) throw new Error(`${field} が不正です`)
}

function assertAllowedKeys(value: object, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unknown.length) throw new Error(label + ' に未定義の項目があります: ' + unknown.join(', '))
}

function assertNoRawMaterial(material: ApplicationMaterialInput): void {
  const record = material as unknown as Record<string, unknown>
  const forbidden = Object.keys(record).filter(
    (key) => /content|body|draft|answer|response|solution/i.test(key) && key !== 'contentHash',
  )
  if (forbidden.length) throw new Error(`ES本文はDBへ渡せません: ${forbidden.join(', ')}`)
  assertAllowedKeys(
    material,
    ['key', 'question', 'sourceRef', 'contentHash', 'charCount', 'charLimit', 'status'],
    'materials',
  )
  if (!material.key?.trim() || !material.question?.trim() || !material.sourceRef?.trim() || !material.contentHash?.trim()) {
    throw new Error('materials は key/question/sourceRef/contentHash が必須です')
  }
  if (!/^[a-f0-9]{64}$/i.test(material.contentHash)) throw new Error('materials.contentHash はSHA-256で指定してください')
  if (!Number.isInteger(material.charCount) || material.charCount < 0) throw new Error('materials.charCount が不正です')
  if (material.charLimit !== undefined && (!Number.isInteger(material.charLimit) || material.charLimit < 0)) {
    throw new Error('materials.charLimit が不正です')
  }
}

function assertSafeAssessment(assessment: AssessmentInput): void {
  const record = assessment as unknown as Record<string, unknown>
  const forbidden = Object.keys(record).filter((key) => /answer|question|solution|screenshot|response/i.test(key))
  if (forbidden.length) throw new Error(`本番適性検査の問題・解答は扱えません: ${forbidden.join(', ')}`)
  assertAllowedKeys(
    assessment,
    [
      'id', 'testType', 'provider', 'url', 'deadline', 'durationMinutes', 'reservationAt',
      'allowedItems', 'environmentStatus', 'status', 'notes', 'sourceRef',
    ],
    'assessment',
  )
  if (!assessment.testType?.trim()) throw new Error('assessment.testType は必須です')
  if (assessment.allowedItems !== undefined && (
    !Array.isArray(assessment.allowedItems) ||
    assessment.allowedItems.some((item) => typeof item !== 'string')
  )) {
    throw new Error('assessment.allowedItems は文字列配列です')
  }
  if ((assessment.notes || '').length > 500) throw new Error('assessment.notes は500文字以内です')
  assertIso(assessment.deadline || '', 'assessment.deadline')
  assertIso(assessment.reservationAt || '', 'assessment.reservationAt')
  if (assessment.durationMinutes !== undefined && (!Number.isInteger(assessment.durationMinutes) || assessment.durationMinutes < 0)) {
    throw new Error('assessment.durationMinutes が不正です')
  }
}

function resolveApplicationTarget(
  db: DatabaseSync,
  company: string,
  position: string,
  season: string,
): { selectionId: number; companyId: number } {
  const resolution = resolveCompany(db, company)
  if (resolution.kind === 'suspicious') {
    throw new Error(`企業名の確認が必要です: ${company} (候補: ${resolution.suggestName})`)
  }
  const companyId = resolution.kind === 'hit' ? resolution.companyId : upsertCompany(db, { name: company })
  const rows = db.prepare('SELECT id, position FROM selection WHERE company_id = ? ORDER BY id')
    .all(companyId) as { id: number; position: string }[]
  if (position) {
    const exact = rows.find((row) => samePosition(row.position, position))
    if (exact) return { selectionId: exact.id, companyId }
  } else if (rows.length === 1) {
    return { selectionId: rows[0].id, companyId }
  } else if (rows.length > 1) {
    throw new Error(`複数トラックのため position が必要です: ${company}`)
  }
  const selectionId = insertSelection(db, companyId, {
    company,
    season,
    position,
    priority: '',
    status: '出願予定',
    steps: [],
    nextAction: 'エントリーを実行',
    nextDate: '',
    submitted: false,
    esUrl: '',
    memo: '応募自動運転から作成',
  }, 'application-autopilot')
  return { selectionId, companyId }
}

export function startApplication(
  db: DatabaseSync,
  input: StartApplicationInput,
): { created: boolean; runId: string; selectionId: number } {
  ensureApplicationSchema(db)
  if (!input || typeof input !== 'object') throw new Error('入力はオブジェクトです')
  assertAllowedKeys(
    input,
    ['runId', 'company', 'position', 'season', 'entryUrl', 'materialsRef', 'sourceRef', 'startedAt'],
    'start',
  )
  const company = input.company?.trim()
  const materialsRef = input.materialsRef?.trim()
  const sourceRef = input.sourceRef?.trim()
  if (!company || !materialsRef || !sourceRef) throw new Error('company/materialsRef/sourceRef は必須です')
  assertIso(input.startedAt || '', 'startedAt')
  return transaction(db, () => {
    const duplicate = db.prepare('SELECT id, selection_id AS selectionId FROM application_run WHERE source_ref = ?')
      .get(sourceRef) as { id: string; selectionId: number } | undefined
    if (duplicate) return { created: false, runId: duplicate.id, selectionId: duplicate.selectionId }
    const runId = input.runId || randomUUID()
    if (db.prepare('SELECT id FROM application_run WHERE id = ?').get(runId)) {
      throw new Error(`runId は既に存在します: ${runId}`)
    }
    const { selectionId } = resolveApplicationTarget(
      db, company, input.position?.trim() || '', input.season?.trim() || '本選考',
    )
    const at = input.startedAt || new Date().toISOString()
    db.prepare(`
      INSERT INTO application_run
        (id, selection_id, state, entry_url, materials_ref, source_ref, started_at, updated_at)
      VALUES (?, ?, 'started', ?, ?, ?, ?, ?)
    `).run(runId, selectionId, input.entryUrl || '', materialsRef, sourceRef, at, at)
    db.prepare(`
      INSERT INTO application_event (id, run_id, at, type, summary, data_json, source_ref)
      VALUES (?, ?, ?, 'start', ?, '{}', ?)
    `).run(`start:${runId}`, runId, at, `${company}の応募自動運転を開始`, sourceRef)
    addEvent(
      db, selectionId, '応募開始', `${company}のエントリーから面接予定確定までを開始`,
      'application-autopilot', at, sourceRef,
    )
    return { created: true, runId, selectionId }
  })
}

function nextState(
  current: ApplicationState,
  previous: string,
  type: ApplicationEventType,
): { state: ApplicationState; previousState: string } {
  if ((current === 'paused' || current === 'failed') && !['resumed', 'note', 'failed'].includes(type)) {
    throw new Error('run は ' + current + ' です。先に resumed を記録してください')
  }
  if (type === 'paused') return { state: 'paused', previousState: current }
  if (type === 'failed') return { state: 'failed', previousState: current === 'failed' ? previous : current }
  if (type === 'resumed') {
    const restored = previous && previous !== 'paused' && previous !== 'failed'
      ? previous as ApplicationState
      : 'started'
    return { state: restored, previousState: '' }
  }
  const stateByEvent: Partial<Record<ApplicationEventType, ApplicationState>> = {
    entry_filled: 'entry_review',
    entry_submitted: 'entry_submitted',
    es_filled: 'es_review',
    es_submitted: 'es_submitted',
    entry_es_submitted: 'es_submitted',
    assessment_detected: 'assessment_pending',
    assessment_ready: 'assessment_ready',
    assessment_completed: 'awaiting_interview',
    awaiting_interview: 'awaiting_interview',
    interview_scheduled: 'interview_scheduled',
  }
  return { state: stateByEvent[type] || current, previousState: previous }
}

function updateSelection(
  db: DatabaseSync,
  selectionId: number,
  stage: Parameters<typeof transition>[1],
  nextAction: string,
  nextDate: string,
  submitted: boolean,
): void {
  const current = db.prepare('SELECT status FROM selection WHERE id = ?').get(selectionId) as { status: string }
  const status = transition(current.status, stage) || current.status
  db.prepare(
    "UPDATE selection SET status = ?, outcome = ?, next_action = ?, next_date = ?, " +
    "submitted = CASE WHEN ? THEN 1 ELSE submitted END, updated_at = ?, " +
    "updated_by = 'application-autopilot' WHERE id = ?",
  ).run(status, outcomeOf(status), nextAction, nextDate, submitted ? 1 : 0, new Date().toISOString(), selectionId)
}

function recordMaterials(
  db: DatabaseSync,
  runId: string,
  materials: ApplicationMaterialInput[] | undefined,
  at: string,
): number {
  if (!materials?.length) throw new Error('es_filled には materials が必要です')
  for (const material of materials) {
    assertNoRawMaterial(material)
    db.prepare(
      'INSERT INTO application_material ' +
      '(run_id, item_key, question, source_ref, content_sha256, char_count, char_limit, status, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(run_id, item_key) DO UPDATE SET question = excluded.question, ' +
      'source_ref = excluded.source_ref, content_sha256 = excluded.content_sha256, ' +
      'char_count = excluded.char_count, char_limit = excluded.char_limit, ' +
      'status = excluded.status, updated_at = excluded.updated_at',
    ).run(
      runId,
      material.key.trim(),
      material.question.trim(),
      material.sourceRef.trim(),
      material.contentHash.toLowerCase(),
      material.charCount,
      material.charLimit || 0,
      material.status || 'ready',
      at,
    )
  }
  return materials.length
}

function requireApproval(event: ApplicationEventInput): void {
  if (event.approvedByUser !== true) {
    throw new Error(event.type + ' は本人の最終承認 approvedByUser=true が必要です')
  }
}

function recordSubmission(
  db: DatabaseSync,
  selectionId: number,
  kind: string,
  at: string,
  sourceRef: string,
  detail: string,
): void {
  db.prepare(
    "INSERT OR IGNORE INTO submission " +
    "(selection_id, kind, submitted_at, result, detail, source_ref, created_at) " +
    "VALUES (?, ?, ?, '', ?, ?, ?)",
  ).run(selectionId, kind, at, detail, sourceRef, new Date().toISOString())
  addEvent(db, selectionId, '提出', kind + 'を本人の最終承認後に提出', 'application-autopilot', at, sourceRef)
}

function upsertAssessment(
  db: DatabaseSync,
  runId: string,
  selectionId: number,
  assessment: AssessmentInput,
  at: string,
): string {
  assertSafeAssessment(assessment)
  const existing = assessment.sourceRef
    ? db.prepare('SELECT id FROM web_assessment WHERE source_ref = ?').get(assessment.sourceRef) as { id: string } | undefined
    : undefined
  const id = existing?.id || assessment.id || randomUUID()
  db.prepare(
    'INSERT INTO web_assessment ' +
    '(id, run_id, selection_id, test_type, provider, url, deadline, duration_minutes, ' +
    'reservation_at, allowed_items_json, environment_status, status, notes, source_ref, created_at, updated_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
    'ON CONFLICT(id) DO UPDATE SET test_type = excluded.test_type, ' +
    "provider = CASE WHEN excluded.provider <> '' THEN excluded.provider ELSE web_assessment.provider END, " +
    "url = CASE WHEN excluded.url <> '' THEN excluded.url ELSE web_assessment.url END, " +
    "deadline = CASE WHEN excluded.deadline <> '' THEN excluded.deadline ELSE web_assessment.deadline END, " +
    'duration_minutes = CASE WHEN excluded.duration_minutes > 0 THEN excluded.duration_minutes ELSE web_assessment.duration_minutes END, ' +
    "reservation_at = CASE WHEN excluded.reservation_at <> '' THEN excluded.reservation_at ELSE web_assessment.reservation_at END, " +
    "allowed_items_json = CASE WHEN excluded.allowed_items_json <> '[]' THEN excluded.allowed_items_json ELSE web_assessment.allowed_items_json END, " +
    'environment_status = excluded.environment_status, status = excluded.status, ' +
    "notes = CASE WHEN excluded.notes <> '' THEN excluded.notes ELSE web_assessment.notes END, updated_at = excluded.updated_at",
  ).run(
    id,
    runId,
    selectionId,
    assessment.testType.trim(),
    assessment.provider || '',
    assessment.url || '',
    assessment.deadline || '',
    assessment.durationMinutes || 0,
    assessment.reservationAt || '',
    JSON.stringify(assessment.allowedItems || []),
    assessment.environmentStatus || '未確認',
    assessment.status || '準備中',
    assessment.notes || '',
    assessment.sourceRef || '',
    at,
    at,
  )
  return id
}

function defaultSummary(type: ApplicationEventType): string {
  const summaries: Record<ApplicationEventType, string> = {
    entry_filled: 'エントリーフォーム入力済み・本人確認待ち',
    entry_submitted: '本人承認後にエントリー送信済み',
    es_filled: 'ES転記済み・本人確認待ち',
    es_submitted: '本人承認後にES提出済み',
    entry_es_submitted: '本人承認後にエントリーとESを提出済み',
    assessment_detected: 'Web適性検査を検出',
    assessment_ready: 'Web適性検査の受検準備完了',
    assessment_completed: '本人がWeb適性検査を受検済み',
    awaiting_interview: '面接案内待ち',
    interview_scheduled: '面接予定をDBへ登録',
    paused: '応募自動運転を一時停止',
    resumed: '応募自動運転を再開',
    failed: '応募自動運転で要確認事項が発生',
    note: '応募自動運転のメモ',
  }
  return summaries[type]
}

export function applyApplicationEvent(
  db: DatabaseSync,
  event: ApplicationEventInput,
): { applied: boolean; runId: string; state: ApplicationState; appointmentId?: number; assessmentId?: string } {
  ensureApplicationSchema(db)
  if (!event || typeof event !== 'object') throw new Error('入力はオブジェクトです')
  assertAllowedKeys(
    event,
    [
      'eventId', 'runId', 'type', 'at', 'summary', 'sourceRef', 'approvedByUser',
      'materials', 'assessment', 'appointment', 'error',
    ],
    'event',
  )
  if (!event.eventId?.trim() || !event.runId?.trim()) throw new Error('eventId/runId は必須です')
  if (!APPLICATION_EVENT_TYPES.has(event.type)) throw new Error('type が不正です: ' + String(event.type))
  if ((event.summary || '').length > 500 || (event.error || '').length > 500) {
    throw new Error('summary/error は500文字以内です')
  }
  assertIso(event.at || '', 'at')
  return transaction(db, () => {
    const duplicate = db.prepare('SELECT id FROM application_event WHERE id = ?').get(event.eventId)
    const run = db.prepare(
      'SELECT id, selection_id AS selectionId, state, previous_state AS previousState ' +
      'FROM application_run WHERE id = ?',
    ).get(event.runId) as {
      id: string
      selectionId: number
      state: ApplicationState
      previousState: string
    } | undefined
    if (!run) throw new Error('application run が見つかりません: ' + event.runId)
    if (duplicate) return { applied: false, runId: run.id, state: run.state }

    const at = event.at || new Date().toISOString()
    const sourceRef = event.sourceRef?.trim() || event.eventId
    const data: Record<string, unknown> = {}
    let appointmentId: number | undefined
    let assessmentId: string | undefined

    switch (event.type) {
      case 'entry_filled':
        updateSelection(db, run.selectionId, 'scouted', 'エントリー内容を本人が最終確認', '', false)
        break
      case 'entry_submitted':
        requireApproval(event)
        recordSubmission(db, run.selectionId, 'エントリー', at, sourceRef, '既存情報を正確に転記し、本人が最終承認')
        updateSelection(db, run.selectionId, 'entried', 'ESまたは次の案内を確認', '', true)
        data.approvedByUser = true
        break
      case 'es_filled':
        data.materialCount = recordMaterials(db, run.id, event.materials, at)
        updateSelection(db, run.selectionId, 'scouted', 'ES内容を本人が最終確認', '', false)
        break
      case 'es_submitted':
        requireApproval(event)
        recordSubmission(db, run.selectionId, 'ES', at, sourceRef, '完成済みESを正確に転記し、本人が最終承認')
        updateSelection(db, run.selectionId, 'task', '適性検査または面接案内を確認', '', true)
        data.approvedByUser = true
        break
      case 'entry_es_submitted':
        requireApproval(event)
        recordSubmission(db, run.selectionId, 'エントリー・ES', at, sourceRef, '完成済み情報を正確に転記し、本人が最終承認')
        updateSelection(db, run.selectionId, 'task', '適性検査または面接案内を確認', '', true)
        data.approvedByUser = true
        break
      case 'assessment_detected':
      case 'assessment_ready': {
        if (!event.assessment) throw new Error(event.type + ' には assessment が必要です')
        assessmentId = upsertAssessment(
          db,
          run.id,
          run.selectionId,
          { ...event.assessment, status: event.type === 'assessment_ready' ? '受検待ち' : event.assessment.status },
          at,
        )
        data.assessmentId = assessmentId
        if (event.assessment.deadline) {
          appointmentId = addAppointment(db, {
            selectionId: run.selectionId,
            at: event.assessment.deadline,
            kind: 'テスト',
            title: event.assessment.testType + ' 締切',
            url: event.assessment.url,
            status: '予定',
          }).id
          data.appointmentId = appointmentId
        }
        updateSelection(
          db,
          run.selectionId,
          'task',
          event.type === 'assessment_ready' ? '本人がWeb適性検査を受検' : 'Web適性検査の環境と期限を確認',
          event.assessment.deadline || '',
          true,
        )
        break
      }
      case 'assessment_completed':
        requireApproval(event)
        if (!event.assessment) throw new Error('assessment_completed には assessment が必要です')
        assessmentId = upsertAssessment(db, run.id, run.selectionId, { ...event.assessment, status: '本人受検済' }, at)
        recordSubmission(db, run.selectionId, 'Web適性検査（本人受検）', at, sourceRef, '本人が受検した事実のみ記録')
        updateSelection(db, run.selectionId, 'task', '選考結果または面接案内を待つ', '', true)
        data.approvedByUser = true
        data.assessmentId = assessmentId
        break
      case 'awaiting_interview':
        updateSelection(db, run.selectionId, 'task', '面接案内を待つ', '', true)
        break
      case 'interview_scheduled': {
        if (!event.appointment) throw new Error('interview_scheduled には appointment が必要です')
        assertAllowedKeys(
          event.appointment,
          ['at', 'endAt', 'kind', 'title', 'url', 'location', 'person'],
          'appointment',
        )
        if (!event.appointment.title?.trim()) throw new Error('appointment.title は必須です')
        assertIso(event.appointment.at, 'appointment.at')
        assertIso(event.appointment.endAt || '', 'appointment.endAt')
        appointmentId = addAppointment(db, {
          selectionId: run.selectionId,
          at: event.appointment.at,
          endAt: event.appointment.endAt,
          kind: event.appointment.kind || '面接',
          title: event.appointment.title,
          url: event.appointment.url,
          location: event.appointment.location,
          person: event.appointment.person,
          status: '予定',
        }).id
        data.appointmentId = appointmentId
        updateSelection(db, run.selectionId, 'interview', '面接準備', event.appointment.at, true)
        addEvent(
          db,
          run.selectionId,
          '面接予定確定',
          event.appointment.title + 'を登録。カレンダー反映待ち',
          'application-autopilot',
          at,
          sourceRef,
        )
        break
      }
      case 'failed':
        data.error = event.error || event.summary || '要確認'
        break
      case 'paused':
      case 'resumed':
      case 'note':
        break
    }

    const next = nextState(run.state, run.previousState, event.type)
    const completedAt = next.state === 'interview_scheduled' ? at : ''
    db.prepare(
      'INSERT INTO application_event (id, run_id, at, type, summary, data_json, source_ref) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(event.eventId, run.id, at, event.type, event.summary || defaultSummary(event.type), JSON.stringify(data), sourceRef)
    db.prepare(
      'UPDATE application_run SET state = ?, previous_state = ?, last_error = ?, updated_at = ?, ' +
      "completed_at = CASE WHEN ? <> '' THEN ? ELSE completed_at END WHERE id = ?",
    ).run(
      next.state,
      next.previousState,
      event.type === 'failed' ? event.error || event.summary || '要確認' : '',
      at,
      completedAt,
      completedAt,
      run.id,
    )
    return { applied: true, runId: run.id, state: next.state, appointmentId, assessmentId }
  })
}

export function listApplicationRuns(db: DatabaseSync): ApplicationRunRow[] {
  ensureApplicationSchema(db)
  return db.prepare(
    'SELECT ar.id, ar.selection_id AS selectionId, c.name AS company, s.position, ' +
    'ar.state, ar.previous_state AS previousState, ar.entry_url AS entryUrl, ' +
    'ar.materials_ref AS materialsRef, ar.source_ref AS sourceRef, ' +
    'ar.last_error AS lastError, ar.started_at AS startedAt, ' +
    'ar.updated_at AS updatedAt, ar.completed_at AS completedAt ' +
    'FROM application_run ar JOIN selection s ON s.id = ar.selection_id ' +
    'JOIN company c ON c.id = s.company_id ORDER BY ar.updated_at DESC',
  ).all() as unknown as ApplicationRunRow[]
}

export function listWebAssessments(db: DatabaseSync): Record<string, unknown>[] {
  ensureApplicationSchema(db)
  return db.prepare(
    'SELECT wa.id, wa.run_id AS runId, wa.selection_id AS selectionId, ' +
    'c.name AS company, s.position, wa.test_type AS testType, ' +
    'wa.provider, wa.url, wa.deadline, wa.duration_minutes AS durationMinutes, ' +
    'wa.reservation_at AS reservationAt, wa.allowed_items_json AS allowedItemsJson, ' +
    'wa.environment_status AS environmentStatus, wa.status, wa.notes, ' +
    'wa.source_ref AS sourceRef, wa.updated_at AS updatedAt ' +
    'FROM web_assessment wa JOIN selection s ON s.id = wa.selection_id ' +
    "JOIN company c ON c.id = s.company_id ORDER BY CASE WHEN wa.deadline = '' THEN 1 ELSE 0 END, " +
    'wa.deadline, wa.updated_at DESC',
  ).all() as unknown as Record<string, unknown>[]
}

export function listCalendarOutbox(db: DatabaseSync, now = new Date()): CalendarOutboxRow[] {
  const earliest = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const latest = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString()
  return db.prepare(
    'SELECT a.id AS appointmentId, a.selection_id AS selectionId, ' +
    'c.name AS company, s.position, a.at, a.end_at AS endAt, ' +
    'a.kind, a.title, a.url, a.location, a.person ' +
    'FROM appointment a JOIN selection s ON s.id = a.selection_id ' +
    'JOIN company c ON c.id = s.company_id ' +
    "WHERE a.status = '予定' AND a.external_id = '' " +
    'AND julianday(a.at) >= julianday(?) AND julianday(a.at) <= julianday(?) ' +
    'ORDER BY a.at, a.id',
  ).all(earliest, latest) as unknown as CalendarOutboxRow[]
}

export function linkCalendarAppointment(
  db: DatabaseSync,
  input: CalendarLinkInput,
): { linked: boolean; appointmentId: number } {
  if (!Number.isInteger(input.appointmentId) || input.appointmentId <= 0 || !input.externalId?.trim()) {
    throw new Error('appointmentId/externalId は必須です')
  }
  return transaction(db, () => {
    const appointment = db.prepare(
      'SELECT id, selection_id AS selectionId, at, end_at AS endAt, kind, title, url, location, person, ' +
      'external_id AS externalId FROM appointment WHERE id = ?',
    ).get(input.appointmentId) as {
      id: number
      selectionId: number
      at: string
      endAt: string
      kind: string
      title: string
      url: string
      location: string
      person: string
      externalId: string
    } | undefined
    if (!appointment) throw new Error('appointment が見つかりません: ' + input.appointmentId)
    if (appointment.externalId) {
      if (appointment.externalId !== input.externalId) throw new Error('appointment は別のカレンダー予定に紐付いています')
      return { linked: false, appointmentId: appointment.id }
    }
    const sourceHash = createHash('sha256').update(JSON.stringify({
      at: appointment.at,
      endAt: appointment.endAt,
      kind: appointment.kind,
      title: appointment.title,
      url: appointment.url,
      location: appointment.location,
      person: appointment.person,
    })).digest('hex')
    db.prepare(
      'UPDATE appointment SET external_id = ?, calendar_id = ?, source_hash = ? WHERE id = ?',
    ).run(input.externalId.trim(), input.calendarId || '', sourceHash, appointment.id)
    addEvent(
      db,
      appointment.selectionId,
      'カレンダー反映',
      appointment.title + 'をカレンダーへ反映',
      'calendar-export',
      undefined,
      'calendar:' + input.externalId.trim(),
    )
    return { linked: true, appointmentId: appointment.id }
  })
}
