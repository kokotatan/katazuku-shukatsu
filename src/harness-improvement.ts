import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { AgentRunResult, FailureCode } from './agent-runtime.js'

export type ImprovementOutcome = 'succeeded' | 'failed' | 'needs_resume'
export type ImprovementCandidateStatus = 'proposed' | 'evaluated' | 'approved' | 'rejected' | 'rolled_back'

export interface HarnessObservation {
  runId: string
  workflowId: string
  outcome: ImprovementOutcome
  provider: string
  failure: FailureCode | ''
  sideEffectState: 'none' | 'workspace' | 'committed' | 'unknown'
  safeToFallback: boolean
  attemptCount: number
  failoverCount: number
  durationMs: number
  observedAt: string
}

export interface ImprovementProposal {
  candidateId: string
  baseRevision: string
  title: string
  rationale: string
  changes: string[]
  risk: 'low' | 'medium' | 'high'
  createdAt: string
}

export interface HarnessEvalCase {
  caseId: string
  kind: 'safety' | 'quality' | 'reliability'
  required: boolean
  baselinePassed: boolean
  candidatePassed: boolean
  baselineScore: number
  candidateScore: number
  baselineLatencyMs: number
  candidateLatencyMs: number
}

export interface CandidateEvaluation {
  status: 'eligible_for_review' | 'rejected'
  reasons: string[]
  baselineScore: number
  candidateScore: number
  baselineLatencyMs: number
  candidateLatencyMs: number
}

export interface HarnessReleaseRecord {
  currentRevision: string
  previousRevision: string
  candidateId: string
  activatedBy: string
  activatedAt: string
}

const FAILURE_CODES = new Set<FailureCode>([
  'command_missing', 'auth_unavailable', 'quota_exhausted', 'rate_limited', 'connection_failed',
  'capability_missing', 'invalid_output', 'timeout', 'partial_side_effect', 'user_action_required', 'runtime_error',
])
const SIDE_EFFECT_STATES = new Set(['none', 'workspace', 'committed', 'unknown'])
const OUTCOMES = new Set<ImprovementOutcome>(['succeeded', 'failed', 'needs_resume'])

function nonEmpty(value: unknown, name: string, max = 300): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\r\n\0]/.test(value)) throw new Error(`${name}が不正です`)
  return value.trim()
}

function iso(value: unknown, name: string): string {
  const text = nonEmpty(value, name, 50)
  if (!Number.isFinite(Date.parse(text))) throw new Error(`${name}が不正です`)
  return new Date(text).toISOString()
}

function numberInRange(value: unknown, name: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`${name}が不正です`)
  return value
}

export function openHarnessImprovementStore(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS harness_observation (
      run_id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, outcome TEXT NOT NULL,
      provider TEXT NOT NULL, failure TEXT NOT NULL, side_effect_state TEXT NOT NULL,
      safe_to_fallback INTEGER NOT NULL, attempt_count INTEGER NOT NULL,
      failover_count INTEGER NOT NULL, duration_ms INTEGER NOT NULL, observed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_harness_observation_workflow
      ON harness_observation(workflow_id, observed_at DESC);
    CREATE TABLE IF NOT EXISTS harness_regression (
      id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, kind TEXT NOT NULL,
      fixture_ref TEXT NOT NULL, expected_json TEXT NOT NULL, source_run_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active','retired')), created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS harness_candidate (
      id TEXT PRIMARY KEY, base_revision TEXT NOT NULL, title TEXT NOT NULL,
      rationale TEXT NOT NULL, changes_json TEXT NOT NULL, risk TEXT NOT NULL,
      status TEXT NOT NULL, evaluation_json TEXT NOT NULL DEFAULT '', approved_by TEXT NOT NULL DEFAULT '',
      approved_revision TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS harness_candidate_event (
      id INTEGER PRIMARY KEY AUTOINCREMENT, candidate_id TEXT NOT NULL REFERENCES harness_candidate(id),
      at TEXT NOT NULL, kind TEXT NOT NULL, detail_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS harness_release (
      id TEXT PRIMARY KEY CHECK(id = 'default'), current_revision TEXT NOT NULL,
      previous_revision TEXT NOT NULL DEFAULT '', candidate_id TEXT NOT NULL DEFAULT '',
      activated_by TEXT NOT NULL, activated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS harness_release_event (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('baseline','activated','rolled_back')),
      from_revision TEXT NOT NULL, to_revision TEXT NOT NULL,
      candidate_id TEXT NOT NULL DEFAULT '', actor TEXT NOT NULL, reason TEXT NOT NULL DEFAULT ''
    );
  `)
  return db
}

/** run台帳からプロンプト・本文・出力・ローカルpathを除外した観測だけを作る。 */
export function observationFromRun(run: AgentRunResult, observedAt = new Date()): HarnessObservation {
  const runId = nonEmpty(run.runId, 'runId')
  const workflowId = nonEmpty(run.workflowId, 'workflowId')
  if (!OUTCOMES.has(run.status)) throw new Error('run statusが不正です')
  if (!SIDE_EFFECT_STATES.has(run.sideEffectState)) throw new Error('sideEffectStateが不正です')
  const failure = run.failure && FAILURE_CODES.has(run.failure) ? run.failure : ''
  const times = run.attempts.flatMap((attempt) => [Date.parse(attempt.startedAt), Date.parse(attempt.finishedAt)]).filter(Number.isFinite)
  const durationMs = times.length ? Math.max(0, Math.max(...times) - Math.min(...times)) : 0
  const providers = run.attempts.filter((attempt) => attempt.status !== 'skipped').map((attempt) => attempt.provider)
  let failoverCount = 0
  for (let index = 1; index < providers.length; index += 1) if (providers[index] !== providers[index - 1]) failoverCount++
  return {
    runId, workflowId, outcome: run.status, provider: String(run.provider || providers.at(-1) || ''), failure,
    sideEffectState: run.sideEffectState, safeToFallback: Boolean(run.safeToFallback),
    attemptCount: run.attempts.length, failoverCount, durationMs, observedAt: observedAt.toISOString(),
  }
}

export function recordHarnessObservation(db: DatabaseSync, value: HarnessObservation): { created: boolean } {
  const observation: HarnessObservation = {
    runId: nonEmpty(value.runId, 'runId'), workflowId: nonEmpty(value.workflowId, 'workflowId'),
    outcome: OUTCOMES.has(value.outcome) ? value.outcome : (() => { throw new Error('outcomeが不正です') })(),
    provider: typeof value.provider === 'string' && value.provider.length <= 100 ? value.provider : '',
    failure: value.failure === '' || FAILURE_CODES.has(value.failure) ? value.failure : (() => { throw new Error('failureが不正です') })(),
    sideEffectState: SIDE_EFFECT_STATES.has(value.sideEffectState) ? value.sideEffectState : (() => { throw new Error('sideEffectStateが不正です') })(),
    safeToFallback: Boolean(value.safeToFallback),
    attemptCount: numberInRange(value.attemptCount, 'attemptCount', 0, 100),
    failoverCount: numberInRange(value.failoverCount, 'failoverCount', 0, 100),
    durationMs: numberInRange(value.durationMs, 'durationMs', 0, 7 * 24 * 60 * 60_000),
    observedAt: iso(value.observedAt, 'observedAt'),
  }
  const result = db.prepare(`INSERT OR IGNORE INTO harness_observation
    (run_id,workflow_id,outcome,provider,failure,side_effect_state,safe_to_fallback,attempt_count,failover_count,duration_ms,observed_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
    observation.runId, observation.workflowId, observation.outcome, observation.provider, observation.failure,
    observation.sideEffectState, observation.safeToFallback ? 1 : 0, observation.attemptCount,
    observation.failoverCount, observation.durationMs, observation.observedAt,
  )
  return { created: Number(result.changes) === 1 }
}

function regressionKind(value: HarnessObservation): 'safety' | 'quality' | 'reliability' {
  if (value.sideEffectState === 'unknown' || value.failure === 'partial_side_effect' || value.failure === 'user_action_required') return 'safety'
  if (value.failure === 'invalid_output') return 'quality'
  return 'reliability'
}

/** 失敗を実データの複製ではなく、同じ契約を再現する合成fixture参照へ変換する。 */
export function ensureRegressionForObservation(db: DatabaseSync, value: HarnessObservation): { created: boolean; id?: string } {
  if (value.outcome === 'succeeded') return { created: false }
  const kind = regressionKind(value)
  const signature = `${value.workflowId}\0${value.failure || value.outcome}\0${value.sideEffectState}`
  const id = `reg:${createHash('sha256').update(signature).digest('hex').slice(0, 24)}`
  const expected = kind === 'safety'
    ? { outcome: value.sideEffectState === 'unknown' ? 'unknown_or_needs_resume' : value.outcome, automaticRetry: false }
    : { classifiedFailure: value.failure || 'runtime_error', preservesRunId: true }
  const result = db.prepare(`INSERT OR IGNORE INTO harness_regression
    (id,workflow_id,kind,fixture_ref,expected_json,source_run_id,status,created_at)
    VALUES(?,?,?,?,?,?, 'active',?)`).run(
    id, value.workflowId, kind, `synthetic:${value.workflowId}:${value.failure || value.outcome}`,
    JSON.stringify(expected), value.runId, value.observedAt,
  )
  return { created: Number(result.changes) === 1, id }
}

export function recordImprovementProposal(db: DatabaseSync, value: ImprovementProposal): { created: boolean } {
  const id = nonEmpty(value.candidateId, 'candidateId', 160)
  const baseRevision = nonEmpty(value.baseRevision, 'baseRevision', 80)
  if (!/^[0-9a-f]{7,64}$/i.test(baseRevision)) throw new Error('baseRevisionが不正です')
  if (!['low', 'medium', 'high'].includes(value.risk)) throw new Error('riskが不正です')
  if (!Array.isArray(value.changes) || value.changes.length < 1 || value.changes.length > 50) throw new Error('changesが不正です')
  const changes = value.changes.map((item) => nonEmpty(item, 'change', 500))
  const createdAt = iso(value.createdAt, 'createdAt')
  const result = db.prepare(`INSERT OR IGNORE INTO harness_candidate
    (id,base_revision,title,rationale,changes_json,risk,status,created_at,updated_at)
    VALUES(?,?,?,?,?,?,'proposed',?,?)`).run(
    id, baseRevision, nonEmpty(value.title, 'title', 300), nonEmpty(value.rationale, 'rationale', 2_000),
    JSON.stringify(changes), value.risk, createdAt, createdAt,
  )
  return { created: Number(result.changes) === 1 }
}

export function evaluateHarnessCandidate(cases: HarnessEvalCase[]): CandidateEvaluation {
  if (!Array.isArray(cases) || cases.length < 3) throw new Error('eval caseは3件以上必要です')
  if (!cases.some((item) => item.kind === 'safety')) throw new Error('safety caseが必要です')
  const reasons: string[] = []
  for (const item of cases) {
    nonEmpty(item.caseId, 'caseId', 200)
    if (!['safety', 'quality', 'reliability'].includes(item.kind)) throw new Error('case kindが不正です')
    numberInRange(item.baselineScore, 'baselineScore', 0, 1)
    numberInRange(item.candidateScore, 'candidateScore', 0, 1)
    numberInRange(item.baselineLatencyMs, 'baselineLatencyMs', 0, 86_400_000)
    numberInRange(item.candidateLatencyMs, 'candidateLatencyMs', 0, 86_400_000)
    if (item.required && !item.candidatePassed) reasons.push(`必須case失敗: ${item.caseId}`)
    if (item.kind === 'safety' && !item.candidatePassed) reasons.push(`safety退行: ${item.caseId}`)
    if (item.baselinePassed && !item.candidatePassed) reasons.push(`既存成功case退行: ${item.caseId}`)
  }
  const average = (key: 'baselineScore' | 'candidateScore' | 'baselineLatencyMs' | 'candidateLatencyMs') =>
    cases.reduce((sum, item) => sum + item[key], 0) / cases.length
  const baselineScore = average('baselineScore')
  const candidateScore = average('candidateScore')
  const baselineLatencyMs = average('baselineLatencyMs')
  const candidateLatencyMs = average('candidateLatencyMs')
  if (candidateScore + 0.001 < baselineScore) reasons.push('平均品質scoreが低下')
  if (baselineLatencyMs > 0 && candidateLatencyMs > baselineLatencyMs * 1.25 && candidateScore - baselineScore < 0.05) {
    reasons.push('品質改善に見合わない遅延増加')
  }
  return { status: reasons.length ? 'rejected' : 'eligible_for_review', reasons: [...new Set(reasons)], baselineScore, candidateScore, baselineLatencyMs, candidateLatencyMs }
}

export function recordCandidateEvaluation(db: DatabaseSync, candidateId: string, cases: HarnessEvalCase[], at = new Date()): CandidateEvaluation {
  const id = nonEmpty(candidateId, 'candidateId', 160)
  const candidate = db.prepare('SELECT status FROM harness_candidate WHERE id = ?').get(id) as { status: ImprovementCandidateStatus } | undefined
  if (!candidate || !['proposed', 'evaluated', 'rejected'].includes(candidate.status)) throw new Error('評価可能なcandidateがありません')
  const evaluation = evaluateHarnessCandidate(cases)
  const status: ImprovementCandidateStatus = evaluation.status === 'eligible_for_review' ? 'evaluated' : 'rejected'
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare('UPDATE harness_candidate SET status=?, evaluation_json=?, updated_at=? WHERE id=?')
      .run(status, JSON.stringify({ evaluation, cases }), at.toISOString(), id)
    db.prepare('INSERT INTO harness_candidate_event(candidate_id,at,kind,detail_json) VALUES(?,?,?,?)')
      .run(id, at.toISOString(), 'evaluation', JSON.stringify(evaluation))
    db.exec('COMMIT')
    return evaluation
  } catch (error) { db.exec('ROLLBACK'); throw error }
}

/** 自動昇格はしない。評価済み候補と、人が確認した実revisionの両方を必要とする。 */
export function approveCandidate(db: DatabaseSync, candidateId: string, approvedBy: string, revision: string, at = new Date()): void {
  const id = nonEmpty(candidateId, 'candidateId', 160)
  const approver = nonEmpty(approvedBy, 'approvedBy', 200)
  if (!/^[0-9a-f]{7,64}$/i.test(revision)) throw new Error('revisionが不正です')
  const candidate = db.prepare('SELECT status,evaluation_json FROM harness_candidate WHERE id=?').get(id) as { status: ImprovementCandidateStatus; evaluation_json: string } | undefined
  if (!candidate || candidate.status !== 'evaluated') throw new Error('評価済みcandidateだけ承認できます')
  const parsed = JSON.parse(candidate.evaluation_json) as { evaluation?: CandidateEvaluation }
  if (parsed.evaluation?.status !== 'eligible_for_review') throw new Error('昇格条件を満たしていません')
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare("UPDATE harness_candidate SET status='approved',approved_by=?,approved_revision=?,updated_at=? WHERE id=?")
      .run(approver, revision, at.toISOString(), id)
    db.prepare('INSERT INTO harness_candidate_event(candidate_id,at,kind,detail_json) VALUES(?,?,?,?)')
      .run(id, at.toISOString(), 'approved', JSON.stringify({ approvedBy: approver, revision }))
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
}

function revision(value: unknown, name: string): string {
  const text = nonEmpty(value, name, 80)
  if (!/^[0-9a-f]{7,64}$/i.test(text)) throw new Error(`${name}が不正です`)
  return text.toLowerCase()
}

export function getHarnessRelease(db: DatabaseSync): HarnessReleaseRecord | undefined {
  const row = db.prepare(`SELECT current_revision AS currentRevision,previous_revision AS previousRevision,
    candidate_id AS candidateId,activated_by AS activatedBy,activated_at AS activatedAt
    FROM harness_release WHERE id='default'`).get() as HarnessReleaseRecord | undefined
  return row ? { ...row } : undefined
}

/** 最初の安定版だけを登録する。既存releaseの上書きや自動bootstrapは行わない。 */
export function registerHarnessBaseline(
  db: DatabaseSync, baselineRevision: string, registeredBy: string, at = new Date(),
): HarnessReleaseRecord {
  const target = revision(baselineRevision, 'baselineRevision')
  const actor = nonEmpty(registeredBy, 'registeredBy', 200)
  if (getHarnessRelease(db)) throw new Error('baselineは登録済みです')
  const timestamp = at.toISOString()
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare(`INSERT INTO harness_release
      (id,current_revision,previous_revision,candidate_id,activated_by,activated_at)
      VALUES('default',?,'','',?,?)`).run(target, actor, timestamp)
    db.prepare(`INSERT INTO harness_release_event
      (at,kind,from_revision,to_revision,candidate_id,actor,reason) VALUES(?,'baseline','',?,'',?,'')`)
      .run(timestamp, target, actor)
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
  return getHarnessRelease(db)!
}

/** 承認済み候補だけを、候補作成時のbase revisionと現在値が一致する場合に昇格する。 */
export function activateApprovedCandidate(
  db: DatabaseSync, candidateId: string, activatedBy: string, expectedCurrentRevision: string, at = new Date(),
): HarnessReleaseRecord {
  const id = nonEmpty(candidateId, 'candidateId', 160)
  const actor = nonEmpty(activatedBy, 'activatedBy', 200)
  const expected = revision(expectedCurrentRevision, 'expectedCurrentRevision')
  const candidate = db.prepare(`SELECT status,base_revision AS baseRevision,approved_revision AS approvedRevision
    FROM harness_candidate WHERE id=?`).get(id) as {
      status: ImprovementCandidateStatus; baseRevision: string; approvedRevision: string
    } | undefined
  if (!candidate || candidate.status !== 'approved') throw new Error('承認済みcandidateだけ昇格できます')
  const approvedRevision = revision(candidate.approvedRevision, 'approvedRevision')
  const baselineRevision = revision(candidate.baseRevision, 'baseRevision')
  const current = getHarnessRelease(db)
  if (!current) throw new Error('baselineが未登録です')
  if (current.currentRevision !== expected) throw new Error('現在revisionがexpectedCurrentRevisionと一致しません')
  if (baselineRevision !== current.currentRevision) throw new Error('candidateのbase revisionが現在revisionと一致しません')
  if (approvedRevision === current.currentRevision) throw new Error('同じrevisionは昇格できません')
  const timestamp = at.toISOString()
  db.exec('BEGIN IMMEDIATE')
  try {
    const changed = db.prepare(`UPDATE harness_release SET current_revision=?,previous_revision=?,candidate_id=?,
      activated_by=?,activated_at=? WHERE id='default' AND current_revision=?`)
      .run(approvedRevision, current.currentRevision, id, actor, timestamp, expected)
    if (Number(changed.changes) !== 1) throw new Error('releaseが競合しました')
    db.prepare(`INSERT INTO harness_release_event
      (at,kind,from_revision,to_revision,candidate_id,actor,reason) VALUES(?,'activated',?,?,?,?, '')`)
      .run(timestamp, current.currentRevision, approvedRevision, id, actor)
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
  return getHarnessRelease(db)!
}

/** 直前の安定版へだけ戻す。任意revisionへの切替や、自動rollbackは許可しない。 */
export function rollbackHarnessRelease(
  db: DatabaseSync, expectedCurrentRevision: string, rolledBackBy: string, reasonText: string, at = new Date(),
): HarnessReleaseRecord {
  const expected = revision(expectedCurrentRevision, 'expectedCurrentRevision')
  const actor = nonEmpty(rolledBackBy, 'rolledBackBy', 200)
  const reason = nonEmpty(reasonText, 'reason', 1000)
  const current = getHarnessRelease(db)
  if (!current) throw new Error('baselineが未登録です')
  if (current.currentRevision !== expected) throw new Error('現在revisionがexpectedCurrentRevisionと一致しません')
  const target = revision(current.previousRevision, 'previousRevision')
  const timestamp = at.toISOString()
  db.exec('BEGIN IMMEDIATE')
  try {
    const changed = db.prepare(`UPDATE harness_release SET current_revision=?,previous_revision='',candidate_id='',
      activated_by=?,activated_at=? WHERE id='default' AND current_revision=?`)
      .run(target, actor, timestamp, expected)
    if (Number(changed.changes) !== 1) throw new Error('releaseが競合しました')
    if (current.candidateId) {
      db.prepare("UPDATE harness_candidate SET status='rolled_back',updated_at=? WHERE id=? AND status='approved'")
        .run(timestamp, current.candidateId)
      db.prepare('INSERT INTO harness_candidate_event(candidate_id,at,kind,detail_json) VALUES(?,?,?,?)')
        .run(current.candidateId, timestamp, 'rolled_back', JSON.stringify({ fromRevision: expected, toRevision: target, actor, reason }))
    }
    db.prepare(`INSERT INTO harness_release_event
      (at,kind,from_revision,to_revision,candidate_id,actor,reason) VALUES(?,'rolled_back',?,?,?,?,?)`)
      .run(timestamp, expected, target, current.candidateId, actor, reason)
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
  return getHarnessRelease(db)!
}

export function harnessImprovementSummary(db: DatabaseSync): Record<string, unknown> {
  return {
    observations: db.prepare('SELECT outcome,COUNT(*) AS count FROM harness_observation GROUP BY outcome ORDER BY outcome').all(),
    failures: db.prepare("SELECT workflow_id AS workflowId,failure,side_effect_state AS sideEffectState,COUNT(*) AS count FROM harness_observation WHERE outcome <> 'succeeded' GROUP BY workflow_id,failure,side_effect_state ORDER BY count DESC,workflow_id").all(),
    regressions: db.prepare("SELECT kind,COUNT(*) AS count FROM harness_regression WHERE status='active' GROUP BY kind ORDER BY kind").all(),
    candidates: db.prepare('SELECT status,COUNT(*) AS count FROM harness_candidate GROUP BY status ORDER BY status').all(),
    release: getHarnessRelease(db),
  }
}

export interface HarnessIngestResult { scanned: number; observed: number; regressions: number; invalid: number }

/** agent-runtimeのrun directoryを1階層だけ走査する。artifact本文は読まず、終端台帳だけを最大1MiBで読む。 */
export async function ingestAgentRunArtifacts(db: DatabaseSync, artifactDir: string, observedAt = new Date()): Promise<HarnessIngestResult> {
  const result: HarnessIngestResult = { scanned: 0, observed: 0, regressions: 0, invalid: 0 }
  let entries
  try { entries = await readdir(artifactDir, { withFileTypes: true }) } catch { return result }
  for (const entry of entries.slice(0, 10_000)) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    result.scanned++
    const ledgerPath = join(artifactDir, entry.name, 'run.local.json')
    try {
      const metadata = await stat(ledgerPath)
      if (!metadata.isFile() || metadata.size < 2 || metadata.size > 1_048_576) throw new Error('ledger size')
      const value = JSON.parse(await readFile(ledgerPath, 'utf8')) as Partial<AgentRunResult>
      if (!Array.isArray(value.attempts) || !value.attempts.every((attempt) => attempt && typeof attempt === 'object')) throw new Error('attempts')
      const observation = observationFromRun(value as AgentRunResult, observedAt)
      if (recordHarnessObservation(db, observation).created) result.observed++
      if (ensureRegressionForObservation(db, observation).created) result.regressions++
    } catch { result.invalid++ }
  }
  return result
}
