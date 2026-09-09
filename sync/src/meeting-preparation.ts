import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { getDatabaseContext, normalizeAppointmentAt } from './db'

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
  const v = value as PreparationInput
  if (!v || !Number.isSafeInteger(v.appointmentId) || v.appointmentId < 1) throw new Error('appointmentIdが必要です')
  for (const key of ['contextHash', 'preparedAt', 'sourceRef', 'summary', 'counterpartResearch', 'priorContext'] as const) {
    if (!nonempty(v[key])) throw new Error(`${key}が必要です`)
  }
  if (!/^[a-f0-9]{64}$/.test(v.contextHash) || !Number.isFinite(Date.parse(v.preparedAt))) throw new Error('contextHash/preparedAtが不正です')
  if (!strings(v.questionsToAsk, 3)) throw new Error('根拠に基づく逆質問が3件以上必要です')
  if (!Array.isArray(v.anticipatedQuestions) || v.anticipatedQuestions.length < 3 ||
      v.anticipatedQuestions.some(q => !q || !nonempty(q.question) || !nonempty(q.answerOutline) || !nonempty(q.evidenceRef))) {
    throw new Error('回答素材の根拠付き想定問答が3件以上必要です')
  }
  if (!Array.isArray(v.sources) || !v.sources.length || v.sources.some(s => !s || !nonempty(s.title) || !validUrl(s.url))) {
    throw new Error('確認した一次情報のtitleとURLが必要です')
  }
  if (!strings(v.unknowns, 0)) throw new Error('unknownsは文字列配列です')
}

/** 全件から導出する。未読/processed、前回の実行成否、48時間の境界で準備義務を失わない。 */
export function evaluateMeetingPreparation(db: DatabaseSync, now = new Date()) {
  if (!Number.isFinite(now.getTime())) throw new Error('評価時刻が不正です')
  const profile = db.prepare('SELECT data_json FROM profile_basic WHERE id = 1').get() as Row | undefined
  const rows = db.prepare(`
    SELECT a.id appointmentId, a.at, a.end_at endAt, a.title, a.kind, a.person,
           a.url, a.location, a.external_id externalId, a.calendar_id calendarId, s.id selectionId, s.position,
           s.status selectionStatus, s.memo selectionMemo,
           c.id companyId, c.name company
    FROM appointment a JOIN selection s ON s.id = a.selection_id JOIN company c ON c.id = s.company_id
    WHERE a.status = '予定' AND a.kind IN ('面接', '面談', '説明会', '座談会')
      AND s.outcome NOT IN ('辞退', '不合格', '終了')
    ORDER BY a.at, a.id
  `).all() as Row[]
  return rows.filter(a => Date.parse(normalizeAppointmentAt(a.at)) >= now.getTime())
    .sort((a, b) => Date.parse(normalizeAppointmentAt(a.at)) - Date.parse(normalizeAppointmentAt(b.at)) || a.appointmentId - b.appointmentId)
    .map(a => {
    const people = db.prepare(`
      SELECT p.id, p.name, p.role, ap.role appointmentRole FROM appointment_person ap
      JOIN person p ON p.id = ap.person_id WHERE ap.appointment_id = ? ORDER BY p.id
    `).all(a.appointmentId).map(p => ({ ...p, notes: db.prepare(`
      SELECT at, note, source_ref sourceRef, confidence FROM person_note WHERE person_id = ? ORDER BY at DESC, id DESC LIMIT 5
    `).all(p.id) }))
    const pastInterviews = db.prepare(`
      SELECT id, occurred_at occurredAt, title, summary, source_ref sourceRef, transcript_path transcriptPath, data_json dataJson
      FROM interview_note WHERE company_id = ? ORDER BY occurred_at DESC, id DESC LIMIT 5
    `).all(a.companyId)
    const dossier = db.prepare('SELECT * FROM company_dossier WHERE company_id = ?').get(a.companyId) as Row | undefined
    const dossierSources = parse(dossier?.sources_json, [])
    const contextHash = createHash('sha256').update(JSON.stringify({
      appointment: a, people, pastInterviews, profile: profile?.data_json ?? '',
      dossier: dossier ? [dossier.summary, dossier.facts_json, dossier.sources_json, dossier.researched_at, dossier.source_ref] : null,
    })).digest('hex')
    const stored = db.prepare('SELECT * FROM appointment_preparation WHERE appointment_id = ?').get(a.appointmentId) as Row | undefined
    const preparation = parse(stored?.data_json, null) as PreparationInput | null
    const reasons: string[] = []
    const researchTime = Date.parse(dossier?.researched_at ?? '')
    if (!dossier?.summary || !Array.isArray(dossierSources) || !dossierSources.length || dossierSources.some(s => !s || !s.title || !validUrl(s.url))) {
      reasons.push('企業研究が未作成、または出典がない')
    } else if (!Number.isFinite(researchTime) || researchTime > now.getTime() + 300_000 || now.getTime() - researchTime > 30 * DAY) {
      reasons.push('企業研究の更新が必要（30日超または日時不正）')
    }
    if (!preparation || stored?.status !== 'ready') reasons.push(stored?.blocker ? `準備が未完了: ${stored.blocker}` : '面談ごとの準備が未作成')
    else {
      try { validatePreparation(preparation) } catch { reasons.push('準備資料の必須項目が不足') }
      if (preparation.appointmentId !== a.appointmentId) reasons.push('準備資料の対象予定が一致しない')
      if (stored.context_hash !== contextHash || preparation.contextHash !== contextHash) reasons.push('予定・面談相手・過去記録・企業研究が更新された')
      const preparedTime = Date.parse(preparation.preparedAt)
      if (!Number.isFinite(preparedTime) || preparedTime > now.getTime() + 300_000 || now.getTime() - preparedTime > 30 * DAY) reasons.push('準備資料の確認日時が古い、または不正')
      if (Date.parse(normalizeAppointmentAt(a.at)) - now.getTime() <= 2 * DAY && now.getTime() - preparedTime > 2 * DAY) reasons.push('48時間以内の最終確認が必要')
    }
    return {
      ...a, contextHash, status: reasons.length ? 'pending' as const : 'ready' as const, reasons,
      urgent: Date.parse(normalizeAppointmentAt(a.at)) - now.getTime() <= 2 * DAY,
      people, pastInterviews,
      dossier: dossier ? { summary: dossier.summary, facts: parse(dossier.facts_json, {}), sources: dossierSources, researchedAt: dossier.researched_at } : null,
      preparation,
    }
  })
}

export function saveMeetingPreparation(db: DatabaseSync, value: unknown, now = new Date()) {
  validatePreparation(value)
  const role = getDatabaseContext(db).role
  if (role !== 'canonical' && role !== 'fixture') throw new Error('面談準備は正本DBにだけ保存できます')
  db.exec('BEGIN IMMEDIATE')
  try {
    const target = evaluateMeetingPreparation(db, now).find(a => a.appointmentId === value.appointmentId)
    if (!target) throw new Error('有効な今後の対象予定がありません')
    if (target.contextHash !== value.contextHash) throw new Error('準備中に根拠が変わりました。listを再取得して再確認してください')
    if (target.reasons.some(r => r.startsWith('企業研究'))) throw new Error('企業研究を先にDBへ保存・更新してください')
    const age = now.getTime() - Date.parse(value.preparedAt)
    if (age < -300_000 || age > (target.urgent ? 2 : 30) * DAY) throw new Error('preparedAtが古い、または未来です')
    db.prepare(`INSERT INTO appointment_preparation
      (appointment_id, context_hash, status, data_json, prepared_at, source_ref, blocker)
      VALUES (?, ?, 'ready', ?, ?, ?, '')
      ON CONFLICT(appointment_id) DO UPDATE SET context_hash=excluded.context_hash, status='ready',
        data_json=excluded.data_json, prepared_at=excluded.prepared_at, source_ref=excluded.source_ref, blocker=''
    `).run(value.appointmentId, value.contextHash, JSON.stringify(value), value.preparedAt, value.sourceRef)
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
}

export function blockMeetingPreparation(db: DatabaseSync, appointmentId: number, blocker: string) {
  if (!nonempty(blocker)) throw new Error('blockerが必要です')
  if (!['canonical', 'fixture'].includes(getDatabaseContext(db).role)) throw new Error('正本DBが必要です')
  const target = evaluateMeetingPreparation(db).find(a => a.appointmentId === appointmentId)
  if (!target) throw new Error('対象予定がありません')
  db.prepare(`INSERT INTO appointment_preparation (appointment_id, context_hash, status, blocker)
    VALUES (?, ?, 'blocked', ?) ON CONFLICT(appointment_id) DO UPDATE SET status='blocked', blocker=excluded.blocker
  `).run(appointmentId, target.contextHash, blocker)
}

/** アプリにはローカルの証拠ファイルパスや内部hashを出さない。 */
export function meetingPreparationSnapshot(db: DatabaseSync, now = new Date()) {
  return evaluateMeetingPreparation(db, now).map(a => ({
    appointmentId: a.appointmentId, companyId: a.companyId, company: a.company,
    at: a.at, title: a.title, status: a.status, reasons: a.reasons,
    ...(a.status === 'ready' && a.preparation ? {
      summary: a.preparation.summary, counterpartResearch: a.preparation.counterpartResearch,
      priorContext: a.preparation.priorContext, questionsToAsk: a.preparation.questionsToAsk,
      anticipatedQuestions: a.preparation.anticipatedQuestions.map(({ question, answerOutline }) => ({ question, answerOutline })),
      sources: a.preparation.sources, unknowns: a.preparation.unknowns, preparedAt: a.preparation.preparedAt,
    } : {}),
  }))
}

/** 重複予定の統合では資料を残す。旧hashは移し替え後に一致しないため、自動で再確認待ちになる。 */
export function moveMeetingPreparation(db: DatabaseSync, sourceId: number, targetId: number) {
  if (sourceId === targetId) throw new Error('統合元と統合先は別の予定です')
  db.prepare(`INSERT OR IGNORE INTO appointment_preparation
    (appointment_id, context_hash, status, data_json, prepared_at, source_ref, blocker)
    SELECT ?, context_hash, status, data_json, prepared_at, source_ref, blocker
    FROM appointment_preparation WHERE appointment_id=?`).run(targetId, sourceId)
  db.prepare('DELETE FROM appointment_preparation WHERE appointment_id=?').run(sourceId)
}
