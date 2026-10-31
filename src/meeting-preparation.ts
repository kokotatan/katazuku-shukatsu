import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { normalizeAppointmentAt } from './db.js'
import { getDatabaseContext } from './schedule.js'

const DAY = 86_400_000
type Row = Record<string, any>
const parse = (value: unknown, fallback: any) => { try { return JSON.parse(String(value)) } catch { return fallback } }
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const strings = (value: unknown, minimum = 1): value is string[] => Array.isArray(value) && value.length >= minimum && value.every(nonempty)
const validUrl = (value: unknown) => { try { return ['https:', 'http:'].includes(new URL(String(value)).protocol) } catch { return false } }

export interface PreparationInput {
  appointmentId: number
  contextHash: string
  preparedAt: string
  sourceRef: string
  summary: string
  counterpartResearch: string
  priorContext: string
  questionsToAsk: string[]
  anticipatedQuestions: { question: string; answerOutline: string; evidenceRef: string }[]
  sources: { title: string; url: string }[]
  unknowns: string[]
}

export function validatePreparation(value: unknown): asserts value is PreparationInput {
  const preparation = value as PreparationInput
  if (!preparation || !Number.isSafeInteger(preparation.appointmentId) || preparation.appointmentId < 1) throw new Error('appointmentIdが必要です')
  for (const key of ['contextHash', 'preparedAt', 'sourceRef', 'summary', 'counterpartResearch', 'priorContext'] as const) {
    if (!nonempty(preparation[key])) throw new Error(`${key}が必要です`)
  }
  if (!/^[a-f0-9]{64}$/.test(preparation.contextHash) || !Number.isFinite(Date.parse(preparation.preparedAt))) throw new Error('contextHash/preparedAtが不正です')
  if (!strings(preparation.questionsToAsk, 3)) throw new Error('根拠に基づく逆質問が3件以上必要です')
  if (!Array.isArray(preparation.anticipatedQuestions) || preparation.anticipatedQuestions.length < 3 || preparation.anticipatedQuestions.some((question) =>
    !question || !nonempty(question.question) || !nonempty(question.answerOutline) || !nonempty(question.evidenceRef))) {
    throw new Error('回答素材の根拠付き想定問答が3件以上必要です')
  }
  if (!Array.isArray(preparation.sources) || !preparation.sources.length || preparation.sources.some((source) =>
    !source || !nonempty(source.title) || !validUrl(source.url))) throw new Error('確認した一次情報のtitleとURLが必要です')
  if (!strings(preparation.unknowns, 0)) throw new Error('unknownsは文字列配列です')
}

/** 未読/processedや48時間境界に依存せず、今後の対象予定を正本から全件再評価する。 */
export function evaluateMeetingPreparation(db: DatabaseSync, now = new Date()) {
  if (!Number.isFinite(now.getTime())) throw new Error('評価時刻が不正です')
  const profile = db.prepare('SELECT data_json FROM profile_basic WHERE id = 1').get() as Row | undefined
  const appointments = db.prepare(`
    SELECT a.id appointmentId, a.at, a.end_at endAt, a.title, a.kind, a.person,
           a.url, a.location, a.external_id externalId, a.calendar_id calendarId,
           s.id selectionId, s.position, s.status selectionStatus, s.memo selectionMemo,
           c.id companyId, c.name company
    FROM appointment a JOIN selection s ON s.id = a.selection_id JOIN company c ON c.id = s.company_id
    WHERE a.status = '予定' AND a.kind IN ('面接', '面談', '説明会', '座談会')
      AND s.outcome NOT IN ('辞退', '不合格', '終了')
    ORDER BY a.at, a.id
  `).all() as Row[]
  return appointments
    .filter((appointment) => Date.parse(normalizeAppointmentAt(appointment.at)) >= now.getTime())
    .sort((left, right) => Date.parse(normalizeAppointmentAt(left.at)) - Date.parse(normalizeAppointmentAt(right.at)) || left.appointmentId - right.appointmentId)
    .map((appointment) => {
      const people = db.prepare(`
        SELECT p.id, p.name, p.role, ap.role appointmentRole FROM appointment_person ap
        JOIN person p ON p.id = ap.person_id WHERE ap.appointment_id = ? ORDER BY p.id
      `).all(appointment.appointmentId).map((person) => ({ ...person, notes: db.prepare(`
        SELECT at, note, source_ref sourceRef, confidence FROM person_note WHERE person_id = ? ORDER BY at DESC, id DESC LIMIT 5
      `).all((person as Row).id) }))
      const pastInterviews = db.prepare(`
        SELECT id, occurred_at occurredAt, title, summary, source_ref sourceRef, transcript_path transcriptPath, data_json dataJson
        FROM interview_note WHERE company_id = ? ORDER BY occurred_at DESC, id DESC LIMIT 5
      `).all(appointment.companyId)
      const dossier = db.prepare('SELECT * FROM company_dossier WHERE company_id = ?').get(appointment.companyId) as Row | undefined
      const dossierSources = parse(dossier?.sources_json, [])
      const { externalId: _externalId, calendarId: _calendarId, ...preparationAppointment } = appointment
      const hashFor = (target: Row) => createHash('sha256').update(JSON.stringify({
        appointment: target, people, pastInterviews, profile: profile?.data_json ?? '',
        dossier: dossier ? [dossier.summary, dossier.facts_json, dossier.sources_json, dossier.researched_at, dossier.source_ref] : null,
      })).digest('hex')
      const contextHash = hashFor(preparationAppointment)
      const compatibleHashes = new Set([contextHash, hashFor(appointment), hashFor({ ...appointment, externalId: '', calendarId: '' })])
      const stored = db.prepare('SELECT * FROM appointment_preparation WHERE appointment_id = ?').get(appointment.appointmentId) as Row | undefined
      const preparation = parse(stored?.data_json, null) as PreparationInput | null
      const reasons: string[] = []
      const researchTime = Date.parse(dossier?.researched_at ?? '')
      if (!dossier?.summary || !Array.isArray(dossierSources) || !dossierSources.length || dossierSources.some((source: Row) => !source || !source.title || !validUrl(source.url))) {
        reasons.push('企業研究が未作成、または出典がない')
      } else if (!Number.isFinite(researchTime) || researchTime > now.getTime() + 300_000 || now.getTime() - researchTime > 30 * DAY) {
        reasons.push('企業研究の更新が必要（30日超または日時不正）')
      }
      if (!preparation || stored?.status !== 'ready') reasons.push(stored?.blocker ? `準備が未完了: ${stored.blocker}` : '面談ごとの準備が未作成')
      else {
        try { validatePreparation(preparation) } catch { reasons.push('準備資料の必須項目が不足') }
        if (preparation.appointmentId !== appointment.appointmentId) reasons.push('準備資料の対象予定が一致しない')
        if (stored.context_hash !== preparation.contextHash || !compatibleHashes.has(preparation.contextHash)) reasons.push('予定・面談相手・過去記録・企業研究が更新された')
        const preparedTime = Date.parse(preparation.preparedAt)
        if (!Number.isFinite(preparedTime) || preparedTime > now.getTime() + 300_000 || now.getTime() - preparedTime > 30 * DAY) reasons.push('準備資料の確認日時が古い、または不正')
        if (Date.parse(normalizeAppointmentAt(appointment.at)) - now.getTime() <= 2 * DAY && now.getTime() - preparedTime > 2 * DAY) reasons.push('48時間以内の最終確認が必要')
      }
      return {
        ...appointment, contextHash, status: reasons.length ? 'pending' as const : 'ready' as const, reasons,
        urgent: Date.parse(normalizeAppointmentAt(appointment.at)) - now.getTime() <= 2 * DAY,
        people, pastInterviews,
        dossier: dossier ? { summary: dossier.summary, facts: parse(dossier.facts_json, {}), sources: dossierSources, researchedAt: dossier.researched_at } : null,
        preparation,
      } as Row & {
        contextHash: string; status: 'pending' | 'ready'; reasons: string[]; urgent: boolean
        people: Row[]; pastInterviews: Row[]; dossier: Row | null; preparation: PreparationInput | null
      }
    })
}

export function saveMeetingPreparation(db: DatabaseSync, value: unknown, now = new Date()): void {
  validatePreparation(value)
  if (!['canonical', 'fixture'].includes(getDatabaseContext(db).role)) throw new Error('面談準備は正本DBにだけ保存できます')
  db.exec('BEGIN IMMEDIATE')
  try {
    const target = evaluateMeetingPreparation(db, now).find((appointment) => appointment.appointmentId === value.appointmentId)
    if (!target) throw new Error('有効な今後の対象予定がありません')
    if (target.contextHash !== value.contextHash) throw new Error('準備中に根拠が変わりました。listを再取得して再確認してください')
    if (target.reasons.some((reason) => reason.startsWith('企業研究'))) throw new Error('企業研究を先にDBへ保存・更新してください')
    const age = now.getTime() - Date.parse(value.preparedAt)
    if (age < -300_000 || age > (target.urgent ? 2 : 30) * DAY) throw new Error('preparedAtが古い、または未来です')
    db.prepare(`INSERT INTO appointment_preparation
      (appointment_id, context_hash, status, data_json, prepared_at, source_ref, blocker)
      VALUES (?, ?, 'ready', ?, ?, ?, '')
      ON CONFLICT(appointment_id) DO UPDATE SET context_hash=excluded.context_hash, status='ready',
        data_json=excluded.data_json, prepared_at=excluded.prepared_at, source_ref=excluded.source_ref, blocker=''`)
      .run(value.appointmentId, value.contextHash, JSON.stringify(value), value.preparedAt, value.sourceRef)
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
}

export function blockMeetingPreparation(db: DatabaseSync, appointmentId: number, blocker: string, now = new Date()): void {
  if (!nonempty(blocker)) throw new Error('blockerが必要です')
  if (!['canonical', 'fixture'].includes(getDatabaseContext(db).role)) throw new Error('正本DBが必要です')
  const target = evaluateMeetingPreparation(db, now).find((appointment) => appointment.appointmentId === appointmentId)
  if (!target) throw new Error('対象予定がありません')
  db.prepare(`INSERT INTO appointment_preparation (appointment_id, context_hash, status, blocker)
    VALUES (?, ?, 'blocked', ?) ON CONFLICT(appointment_id) DO UPDATE SET context_hash=excluded.context_hash, status='blocked', blocker=excluded.blocker`)
    .run(appointmentId, target.contextHash, blocker)
}

/** ローカル証拠ファイルのpathや内部hashを外部スナップショットへ出さない。 */
export function meetingPreparationSnapshot(db: DatabaseSync, now = new Date()) {
  return evaluateMeetingPreparation(db, now).map((appointment) => ({
    appointmentId: appointment.appointmentId, companyId: appointment.companyId, company: appointment.company,
    at: appointment.at, title: appointment.title, status: appointment.status, reasons: appointment.reasons, urgent: appointment.urgent,
    ...(appointment.status === 'ready' && appointment.preparation ? {
      summary: appointment.preparation.summary, counterpartResearch: appointment.preparation.counterpartResearch,
      priorContext: appointment.preparation.priorContext, questionsToAsk: appointment.preparation.questionsToAsk,
      anticipatedQuestions: appointment.preparation.anticipatedQuestions.map(({ question, answerOutline }) => ({ question, answerOutline })),
      sources: appointment.preparation.sources, unknowns: appointment.preparation.unknowns, preparedAt: appointment.preparation.preparedAt,
    } : {}),
  }))
}

/** 準備を作るagent向け。根拠hashは返すが、文字起こしpath・内部JSON・証拠pathは返さない。 */
export function meetingPreparationContext(db: DatabaseSync, now = new Date()) {
  return evaluateMeetingPreparation(db, now).map((appointment) => ({
    appointmentId: appointment.appointmentId,
    company: appointment.company,
    position: appointment.position,
    at: appointment.at,
    title: appointment.title,
    person: appointment.person,
    contextHash: appointment.contextHash,
    status: appointment.status,
    reasons: appointment.reasons,
    urgent: appointment.urgent,
    people: appointment.people.map((person: Row) => ({
      id: person.id, name: person.name, role: person.role, appointmentRole: person.appointmentRole,
      notes: (person.notes as Row[]).map((note) => ({ at: note.at, note: note.note, confidence: note.confidence })),
    })),
    pastInterviews: appointment.pastInterviews.map((interview: Row) => ({
      occurredAt: interview.occurredAt, title: interview.title, summary: interview.summary,
    })),
    dossier: appointment.dossier,
    preparation: appointment.status === 'ready' && appointment.preparation ? {
      summary: appointment.preparation.summary,
      counterpartResearch: appointment.preparation.counterpartResearch,
      priorContext: appointment.preparation.priorContext,
      questionsToAsk: appointment.preparation.questionsToAsk,
      anticipatedQuestions: appointment.preparation.anticipatedQuestions.map(({ question, answerOutline }) => ({ question, answerOutline })),
      sources: appointment.preparation.sources,
      unknowns: appointment.preparation.unknowns,
      preparedAt: appointment.preparation.preparedAt,
    } : null,
  }))
}

export function moveMeetingPreparation(db: DatabaseSync, sourceId: number, targetId: number): void {
  if (sourceId === targetId) throw new Error('統合元と統合先は別の予定です')
  db.prepare(`INSERT OR IGNORE INTO appointment_preparation
    (appointment_id, context_hash, status, data_json, prepared_at, source_ref, blocker)
    SELECT ?, context_hash, status, data_json, prepared_at, source_ref, blocker
    FROM appointment_preparation WHERE appointment_id=?`).run(targetId, sourceId)
  db.prepare('DELETE FROM appointment_preparation WHERE appointment_id=?').run(sourceId)
}
