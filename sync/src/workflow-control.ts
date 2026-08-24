import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { DatabaseContext } from './db'
import { validateJsonSchema } from './agent-runtime'

export const WORKFLOW_OWNERS = ['trigger', 'executor', 'agent', 'user'] as const
export type WorkflowOwner = (typeof WORKFLOW_OWNERS)[number]

export const WORKFLOW_EFFECTS = [
  'none',
  'db-write',
  'external-draft',
  'internal-sync',
  'third-party-commit',
] as const
export type WorkflowEffect = (typeof WORKFLOW_EFFECTS)[number]

export type WorkflowRunStatus = 'running' | 'needs_user' | 'done' | 'failed' | 'unknown'
export type WorkflowStepStatus = 'pending' | 'running' | 'needs_user' | 'succeeded' | 'failed' | 'unknown'

export interface WorkflowStepContract {
  id: string
  title: string
  owner: WorkflowOwner
  sideEffect: WorkflowEffect
  capabilities: string[]
  inputSchema?: string
  outputSchema?: string
  approval: 'none' | 'user'
  requiresApprovalFrom?: string
  idempotency: 'not-applicable' | 'run-step' | 'external-key'
  next: string | null
}

export interface WorkflowContract {
  schemaVersion: 1
  id: string
  version: number
  title: string
  database: { requiredRole: 'canonical' | 'any' }
  firstStep: string
  steps: WorkflowStepContract[]
}

const CONTRACT_BASE_DIR = new WeakMap<WorkflowContract, string>()

export interface WorkflowRunRecord {
  runId: string
  workflowId: string
  contractVersion: number
  contractHash: string
  inputHash: string
  status: WorkflowRunStatus
  currentStepId: string
  targetDatabaseId: string
  targetDatabasePath: string
  targetDatabaseRole: string
  lastError: string
  createdAt: string
  updatedAt: string
}

export interface WorkflowStepRunRecord {
  runId: string
  stepId: string
  owner: WorkflowOwner
  status: WorkflowStepStatus
  inputHash: string
  outputHash: string
  outputRef: string
  lastError: string
  startedAt: string
  finishedAt: string
  updatedAt: string
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonicalize(item)]))
  }
  return value
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

export function workflowHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function isIdentifier(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]*$/.test(value)
}

/** 契約が安全境界を弱める定義になっていないか、実行前に機械検証する。 */
export function validateWorkflowContract(contract: WorkflowContract): void {
  const errors: string[] = []
  const topAllowed = new Set(['$schema', 'schemaVersion', 'id', 'version', 'title', 'database', 'firstStep', 'steps'])
  const stepAllowed = new Set([
    'id', 'title', 'owner', 'sideEffect', 'capabilities', 'inputSchema', 'outputSchema',
    'approval', 'requiresApprovalFrom', 'idempotency', 'next',
  ])
  for (const key of Object.keys(contract as unknown as Record<string, unknown>)) {
    if (!topAllowed.has(key)) errors.push(`未知のworkflow項目です: ${key}`)
  }
  if (contract.schemaVersion !== 1) errors.push('schemaVersion は1のみ対応しています')
  if (!isIdentifier(contract.id)) errors.push(`workflow idが不正です: ${contract.id}`)
  if (!Number.isInteger(contract.version) || contract.version < 1) errors.push('versionは1以上の整数が必要です')
  if (!contract.title?.trim()) errors.push('titleは必須です')
  if (!contract.database || !['canonical', 'any'].includes(contract.database.requiredRole)) {
    errors.push('database.requiredRoleはcanonicalまたはanyです')
  } else {
    for (const key of Object.keys(contract.database)) {
      if (key !== 'requiredRole') errors.push(`未知のdatabase項目です: ${key}`)
    }
  }
  if (!Array.isArray(contract.steps) || contract.steps.length === 0) errors.push('stepsは1件以上必要です')

  const ids = new Set<string>()
  const positions = new Map<string, number>()
  contract.steps.forEach((step, index) => {
    const capabilities = Array.isArray(step.capabilities) ? step.capabilities : []
    for (const key of Object.keys(step as unknown as Record<string, unknown>)) {
      if (!stepAllowed.has(key)) errors.push(`${step.id || `step[${index}]`}: 未知の項目です: ${key}`)
    }
    if (!isIdentifier(step.id)) errors.push(`step idが不正です: ${step.id}`)
    if (ids.has(step.id)) errors.push(`step idが重複しています: ${step.id}`)
    ids.add(step.id)
    positions.set(step.id, index)
    if (!step.title?.trim()) errors.push(`${step.id}: titleは必須です`)
    if (!WORKFLOW_OWNERS.includes(step.owner)) errors.push(`${step.id}: ownerが不正です`)
    if (!WORKFLOW_EFFECTS.includes(step.sideEffect)) errors.push(`${step.id}: sideEffectが不正です`)
    if (!Array.isArray(step.capabilities)) errors.push(`${step.id}: capabilitiesは配列が必要です`)
    else if (new Set(capabilities).size !== capabilities.length) errors.push(`${step.id}: capabilityが重複しています`)
    if (!['none', 'user'].includes(step.approval)) errors.push(`${step.id}: approvalが不正です`)
    if (!['not-applicable', 'run-step', 'external-key'].includes(step.idempotency)) {
      errors.push(`${step.id}: idempotencyが不正です`)
    }
    if (step.owner === 'agent') {
      if (step.sideEffect !== 'none') errors.push(`${step.id}: Agent stepは副作用を持てません`)
      if (!step.outputSchema) errors.push(`${step.id}: Agent stepにはoutputSchemaが必要です`)
      if (step.approval !== 'none') errors.push(`${step.id}: Agent stepにapprovalは設定できません`)
    }
    if (step.owner === 'user') {
      if (step.approval !== 'user') errors.push(`${step.id}: User stepにはapproval:userが必要です`)
      if (step.sideEffect !== 'none') errors.push(`${step.id}: User stepは副作用を持てません`)
      if (capabilities.length) errors.push(`${step.id}: User stepにcapabilityは設定できません`)
      if (!step.inputSchema) errors.push(`${step.id}: User承認stepにはinputSchemaが必要です`)
    }
    if (step.sideEffect === 'third-party-commit') {
      if (step.owner !== 'executor') errors.push(`${step.id}: 第三者確定操作はExecutorだけが実行できます`)
      if (!step.requiresApprovalFrom) errors.push(`${step.id}: 第三者確定操作には承認stepが必要です`)
    }
    if (step.sideEffect !== 'none' && step.owner !== 'executor') {
      errors.push(`${step.id}: 副作用を持てるownerはExecutorだけです`)
    }
  })

  if (!ids.has(contract.firstStep)) errors.push(`firstStepが存在しません: ${contract.firstStep}`)
  for (const step of contract.steps) {
    if (step.next !== null && typeof step.next !== 'string') errors.push(`${step.id}: nextはstep idまたはnullです`)
    if (step.next !== null && !ids.has(step.next)) errors.push(`${step.id}: nextが存在しません: ${step.next}`)
    if (step.requiresApprovalFrom) {
      const approval = contract.steps.find((candidate) => candidate.id === step.requiresApprovalFrom)
      if (!approval) errors.push(`${step.id}: 承認stepが存在しません: ${step.requiresApprovalFrom}`)
      else {
        if (approval.owner !== 'user' || approval.approval !== 'user') {
          errors.push(`${step.id}: requiresApprovalFromはUser承認stepを参照する必要があります`)
        }
        if ((positions.get(approval.id) ?? Infinity) >= (positions.get(step.id) ?? -1)) {
          errors.push(`${step.id}: 承認stepは確定操作より前に置く必要があります`)
        }
      }
    }
  }

  const reachable = new Set<string>()
  let cursor: string | null = contract.firstStep
  while (cursor && !reachable.has(cursor)) {
    reachable.add(cursor)
    cursor = contract.steps.find((step) => step.id === cursor)?.next ?? null
  }
  if (cursor) errors.push(`step遷移が循環しています: ${cursor}`)
  for (const id of ids) if (!reachable.has(id)) errors.push(`firstStepから到達できないstepです: ${id}`)
  if (errors.length) throw new Error('workflow契約が不正です:\n- ' + errors.join('\n- '))
}

export function loadWorkflowContract(path: string): WorkflowContract {
  const absolute = resolve(path)
  const contract = JSON.parse(readFileSync(absolute, 'utf8')) as WorkflowContract
  validateWorkflowContract(contract)
  const base = dirname(absolute)
  for (const step of contract.steps) {
    for (const schemaPath of [step.inputSchema, step.outputSchema]) {
      if (schemaPath && !existsSync(resolve(base, schemaPath))) {
        throw new Error(`${step.id}: Schemaが見つかりません: ${schemaPath}`)
      }
    }
  }
  CONTRACT_BASE_DIR.set(contract, base)
  return contract
}

function validateStepPayload(
  contract: WorkflowContract,
  step: WorkflowStepContract,
  schemaKind: 'input' | 'output',
  value: unknown,
): void {
  const schemaRef = schemaKind === 'input' ? step.inputSchema : step.outputSchema
  if (!schemaRef) return
  const path = isAbsolute(schemaRef) ? schemaRef : resolve(CONTRACT_BASE_DIR.get(contract) ?? process.cwd(), schemaRef)
  const schema = JSON.parse(readFileSync(path, 'utf8'))
  const errors = validateJsonSchema(value, schema)
  if (errors.length) throw new Error(`${step.id}: ${schemaKind}がSchemaに一致しません:\n- ${errors.slice(0, 12).join('\n- ')}`)
}

export function ensureWorkflowControlSchema(db: DatabaseSync): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS workflow_run (
      run_id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      contract_version INTEGER NOT NULL,
      contract_hash TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('running','needs_user','done','failed','unknown')),
      current_step_id TEXT NOT NULL,
      target_database_id TEXT NOT NULL,
      target_database_path TEXT NOT NULL,
      target_database_role TEXT NOT NULL,
      last_error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_run_status ON workflow_run(status, updated_at);
    CREATE TABLE IF NOT EXISTS workflow_step_run (
      run_id TEXT NOT NULL REFERENCES workflow_run(run_id),
      step_id TEXT NOT NULL,
      owner TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending','running','needs_user','succeeded','failed','unknown')),
      input_hash TEXT NOT NULL DEFAULT '',
      output_hash TEXT NOT NULL DEFAULT '',
      output_ref TEXT NOT NULL DEFAULT '',
      last_error TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL DEFAULT '',
      finished_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (run_id, step_id)
    );
    CREATE TABLE IF NOT EXISTS workflow_approval (
      run_id TEXT NOT NULL REFERENCES workflow_run(run_id),
      step_id TEXT NOT NULL,
      action_hash TEXT NOT NULL,
      action_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('requested','approved','rejected','consumed')),
      requested_at TEXT NOT NULL,
      decided_at TEXT NOT NULL DEFAULT '',
      consumed_at TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (run_id, step_id)
    );
  `)
}

export function openWorkflowStore(path: string): DatabaseSync {
  const absolute = path === ':memory:' ? path : resolve(path)
  if (absolute !== ':memory:') mkdirSync(dirname(absolute), { recursive: true })
  const db = new DatabaseSync(absolute)
  ensureWorkflowControlSchema(db)
  return db
}

function nowIso(now?: Date): string {
  return (now ?? new Date()).toISOString()
}

function inTransaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = work()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function runRow(db: DatabaseSync, runId: string): WorkflowRunRecord | undefined {
  return db.prepare(`
    SELECT run_id AS runId, workflow_id AS workflowId, contract_version AS contractVersion,
      contract_hash AS contractHash, input_hash AS inputHash, status, current_step_id AS currentStepId,
      target_database_id AS targetDatabaseId, target_database_path AS targetDatabasePath,
      target_database_role AS targetDatabaseRole, last_error AS lastError,
      created_at AS createdAt, updated_at AS updatedAt
    FROM workflow_run WHERE run_id = ?
  `).get(runId) as WorkflowRunRecord | undefined
}

function stepRow(db: DatabaseSync, runId: string, stepId: string): WorkflowStepRunRecord | undefined {
  return db.prepare(`
    SELECT run_id AS runId, step_id AS stepId, owner, status, input_hash AS inputHash,
      output_hash AS outputHash, output_ref AS outputRef, last_error AS lastError,
      started_at AS startedAt, finished_at AS finishedAt, updated_at AS updatedAt
    FROM workflow_step_run WHERE run_id = ? AND step_id = ?
  `).get(runId, stepId) as WorkflowStepRunRecord | undefined
}

function assertContractMatches(run: WorkflowRunRecord, contract: WorkflowContract): void {
  const hash = workflowHash(contract)
  if (run.workflowId !== contract.id || run.contractVersion !== contract.version || run.contractHash !== hash) {
    throw new Error('開始時からworkflow契約が変更されています。既存runは新しい契約で再開できません')
  }
}

function currentStep(contract: WorkflowContract, run: WorkflowRunRecord, stepId: string): WorkflowStepContract {
  assertContractMatches(run, contract)
  if (run.currentStepId !== stepId) throw new Error(`現在のstepは${run.currentStepId}です。${stepId}は実行できません`)
  const step = contract.steps.find((candidate) => candidate.id === stepId)
  if (!step) throw new Error(`契約にstepがありません: ${stepId}`)
  return step
}

export function startWorkflowRun(
  db: DatabaseSync,
  contract: WorkflowContract,
  input: unknown,
  targetDatabase: DatabaseContext,
  runId: string,
  now?: Date,
): WorkflowRunRecord {
  validateWorkflowContract(contract)
  if (!runId.trim()) throw new Error('runIdは必須です')
  if (contract.database.requiredRole === 'canonical' && targetDatabase.role !== 'canonical') {
    throw new Error(`このworkflowはcanonical DB専用です: role=${targetDatabase.role}`)
  }
  const contractHash = workflowHash(contract)
  const inputHash = workflowHash(input)
  const existing = runRow(db, runId)
  if (existing) {
    assertContractMatches(existing, contract)
    if (existing.inputHash !== inputHash) throw new Error('同じrunIdへ異なる入力を与えることはできません')
    if (existing.targetDatabaseId !== targetDatabase.databaseId || existing.targetDatabaseRole !== targetDatabase.role ||
      existing.targetDatabasePath !== targetDatabase.path) {
      throw new Error('開始時と異なるDBではworkflowを再開できません')
    }
    return existing
  }
  const timestamp = nowIso(now)
  inTransaction(db, () => {
    db.prepare(`
      INSERT INTO workflow_run
        (run_id, workflow_id, contract_version, contract_hash, input_hash, status, current_step_id,
         target_database_id, target_database_path, target_database_role, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?)
    `).run(runId, contract.id, contract.version, contractHash, inputHash, contract.firstStep,
      targetDatabase.databaseId, targetDatabase.path, targetDatabase.role, timestamp, timestamp)
    const insertStep = db.prepare(`
      INSERT INTO workflow_step_run (run_id, step_id, owner, status, updated_at)
      VALUES (?, ?, ?, 'pending', ?)
    `)
    for (const step of contract.steps) insertStep.run(runId, step.id, step.owner, timestamp)
  })
  return runRow(db, runId)!
}

function assertTargetDatabase(run: WorkflowRunRecord, target: DatabaseContext): void {
  if (run.targetDatabaseId !== target.databaseId || run.targetDatabaseRole !== target.role ||
    run.targetDatabasePath !== target.path) {
    throw new Error('開始時と異なるDB identity/role/pathでstepを実行できません')
  }
}

function assertCapabilities(step: WorkflowStepContract, capabilities?: string[]): void {
  if (!capabilities) {
    if (step.owner === 'agent') throw new Error(`${step.id}: Agent stepには契約由来のcapabilities指定が必要です`)
    return
  }
  const expected = [...new Set(step.capabilities)].sort()
  const actual = [...new Set(capabilities)].sort()
  if (canonicalJson(expected) !== canonicalJson(actual)) {
    throw new Error(`${step.id}: 契約外のcapabilityです。expected=${expected.join(',')} actual=${actual.join(',')}`)
  }
}

export function beginWorkflowStep(
  db: DatabaseSync,
  contract: WorkflowContract,
  runId: string,
  stepId: string,
  owner: WorkflowOwner,
  options: { input?: unknown; capabilities?: string[]; action?: unknown; targetDatabase: DatabaseContext; now?: Date },
): WorkflowStepRunRecord {
  const run = runRow(db, runId)
  if (!run) throw new Error(`workflow runがありません: ${runId}`)
  assertTargetDatabase(run, options.targetDatabase)
  if (run.status !== 'running') throw new Error(`run status=${run.status}のためstepを開始できません`)
  const step = currentStep(contract, run, stepId)
  if (step.owner === 'user') throw new Error('User stepはrequestWorkflowApprovalで開始してください')
  if (step.owner !== owner) throw new Error(`${stepId}のownerは${step.owner}です。${owner}では開始できません`)
  assertCapabilities(step, options.capabilities)
  const record = stepRow(db, runId, stepId)!
  if (record.status !== 'pending') throw new Error(`${stepId}はpendingではありません: ${record.status}`)
  if (step.requiresApprovalFrom) {
    if (options.action === undefined) throw new Error(`${stepId}には承認対象actionが必要です`)
    const approval = db.prepare(`
      SELECT action_hash AS actionHash, status FROM workflow_approval WHERE run_id = ? AND step_id = ?
    `).get(runId, step.requiresApprovalFrom) as { actionHash: string; status: string } | undefined
    if (!approval || approval.status !== 'approved') throw new Error(`${stepId}に必要な本人承認がありません`)
    if (approval.actionHash !== workflowHash(options.action)) throw new Error('承認後に宛先・本文・日時・通知内容が変更されています')
  }
  const timestamp = nowIso(options.now)
  db.prepare(`
    UPDATE workflow_step_run SET status = 'running', input_hash = ?, started_at = ?, updated_at = ?
    WHERE run_id = ? AND step_id = ?
  `).run(options.input === undefined ? '' : workflowHash(options.input), timestamp, timestamp, runId, stepId)
  return stepRow(db, runId, stepId)!
}

export function completeWorkflowStep(
  db: DatabaseSync,
  contract: WorkflowContract,
  runId: string,
  stepId: string,
  owner: WorkflowOwner,
  options: { output?: unknown; outputRef?: string; action?: unknown; targetDatabase: DatabaseContext; now?: Date },
): WorkflowRunRecord {
  const run = runRow(db, runId)
  if (!run) throw new Error(`workflow runがありません: ${runId}`)
  assertTargetDatabase(run, options.targetDatabase)
  const step = currentStep(contract, run, stepId)
  if (step.owner !== owner) throw new Error(`${stepId}のownerは${step.owner}です`)
  const record = stepRow(db, runId, stepId)!
  if (record.status !== 'running') throw new Error(`${stepId}はrunningではありません: ${record.status}`)
  const timestamp = nowIso(options.now)
  if (step.outputSchema) {
    if (options.output === undefined) throw new Error(`${stepId}: Schema付きstepの完了にはoutputが必要です`)
    validateStepPayload(contract, step, 'output', options.output)
  }
  inTransaction(db, () => {
    db.prepare(`
      UPDATE workflow_step_run SET status = 'succeeded', output_hash = ?, output_ref = ?,
        finished_at = ?, updated_at = ? WHERE run_id = ? AND step_id = ?
    `).run(options.output === undefined ? '' : workflowHash(options.output), options.outputRef ?? '',
      timestamp, timestamp, runId, stepId)
    if (step.requiresApprovalFrom) {
      if (options.action === undefined) throw new Error(`${stepId}の完了には実行したactionが必要です`)
      const hash = workflowHash(options.action)
      const approval = db.prepare(`SELECT action_hash AS actionHash, status FROM workflow_approval
        WHERE run_id = ? AND step_id = ?`).get(runId, step.requiresApprovalFrom) as
        { actionHash: string; status: string } | undefined
      if (!approval || approval.status !== 'approved' || approval.actionHash !== hash) {
        throw new Error('実行結果を承認内容へ結び付けられません')
      }
      db.prepare(`UPDATE workflow_approval SET status = 'consumed', consumed_at = ?
        WHERE run_id = ? AND step_id = ?`).run(timestamp, runId, step.requiresApprovalFrom)
    }
    db.prepare(`UPDATE workflow_run SET status = ?, current_step_id = ?, updated_at = ? WHERE run_id = ?`)
      .run(step.next ? 'running' : 'done', step.next ?? step.id, timestamp, runId)
  })
  return runRow(db, runId)!
}

export function failWorkflowStep(
  db: DatabaseSync,
  contract: WorkflowContract,
  runId: string,
  stepId: string,
  owner: WorkflowOwner,
  status: 'failed' | 'unknown',
  error: string,
  now?: Date,
): WorkflowRunRecord {
  const run = runRow(db, runId)
  if (!run) throw new Error(`workflow runがありません: ${runId}`)
  const step = currentStep(contract, run, stepId)
  if (step.owner !== owner) throw new Error(`${stepId}のownerは${step.owner}です`)
  const record = stepRow(db, runId, stepId)!
  if (!['pending', 'running', 'needs_user'].includes(record.status)) {
    throw new Error(`${stepId}は失敗状態へ遷移できません: ${record.status}`)
  }
  const timestamp = nowIso(now)
  inTransaction(db, () => {
    db.prepare(`UPDATE workflow_step_run SET status = ?, last_error = ?, finished_at = ?, updated_at = ?
      WHERE run_id = ? AND step_id = ?`).run(status, error, timestamp, timestamp, runId, stepId)
    db.prepare(`UPDATE workflow_run SET status = ?, last_error = ?, updated_at = ? WHERE run_id = ?`)
      .run(status, error, timestamp, runId)
  })
  return runRow(db, runId)!
}

export function requestWorkflowApproval(
  db: DatabaseSync,
  contract: WorkflowContract,
  runId: string,
  stepId: string,
  action: unknown,
  targetDatabase: DatabaseContext,
  now?: Date,
): { run: WorkflowRunRecord; actionHash: string } {
  const run = runRow(db, runId)
  if (!run) throw new Error(`workflow runがありません: ${runId}`)
  assertTargetDatabase(run, targetDatabase)
  if (run.status !== 'running') throw new Error(`run status=${run.status}のため承認依頼できません`)
  const step = currentStep(contract, run, stepId)
  if (step.owner !== 'user' || step.approval !== 'user') throw new Error(`${stepId}は本人承認stepではありません`)
  const record = stepRow(db, runId, stepId)!
  if (record.status !== 'pending') throw new Error(`${stepId}はpendingではありません: ${record.status}`)
  const timestamp = nowIso(now)
  const actionHash = workflowHash(action)
  validateStepPayload(contract, step, 'input', action)
  inTransaction(db, () => {
    db.prepare(`INSERT INTO workflow_approval
      (run_id, step_id, action_hash, action_json, status, requested_at)
      VALUES (?, ?, ?, ?, 'requested', ?)`)
      .run(runId, stepId, actionHash, canonicalJson(action), timestamp)
    db.prepare(`UPDATE workflow_step_run SET status = 'needs_user', input_hash = ?, started_at = ?, updated_at = ?
      WHERE run_id = ? AND step_id = ?`).run(actionHash, timestamp, timestamp, runId, stepId)
    db.prepare(`UPDATE workflow_run SET status = 'needs_user', updated_at = ? WHERE run_id = ?`).run(timestamp, runId)
  })
  return { run: runRow(db, runId)!, actionHash }
}

export function decideWorkflowApproval(
  db: DatabaseSync,
  contract: WorkflowContract,
  runId: string,
  stepId: string,
  action: unknown,
  decision: 'approved' | 'rejected',
  targetDatabase: DatabaseContext,
  now?: Date,
): WorkflowRunRecord {
  const run = runRow(db, runId)
  if (!run) throw new Error(`workflow runがありません: ${runId}`)
  assertTargetDatabase(run, targetDatabase)
  if (run.status !== 'needs_user') throw new Error(`run status=${run.status}のため承認判断できません`)
  const step = currentStep(contract, run, stepId)
  if (step.owner !== 'user' || step.approval !== 'user') throw new Error(`${stepId}は本人承認stepではありません`)
  const approval = db.prepare(`SELECT action_hash AS actionHash, status FROM workflow_approval
    WHERE run_id = ? AND step_id = ?`).get(runId, stepId) as { actionHash: string; status: string } | undefined
  if (!approval || approval.status !== 'requested') throw new Error('有効な承認依頼がありません')
  if (approval.actionHash !== workflowHash(action)) throw new Error('提示時と異なる承認内容です')
  const timestamp = nowIso(now)
  inTransaction(db, () => {
    db.prepare(`UPDATE workflow_approval SET status = ?, decided_at = ? WHERE run_id = ? AND step_id = ?`)
      .run(decision, timestamp, runId, stepId)
    db.prepare(`UPDATE workflow_step_run SET status = ?, finished_at = ?, updated_at = ?
      WHERE run_id = ? AND step_id = ?`)
      .run(decision === 'approved' ? 'succeeded' : 'failed', timestamp, timestamp, runId, stepId)
    db.prepare(`UPDATE workflow_run SET status = ?, current_step_id = ?, last_error = ?, updated_at = ? WHERE run_id = ?`)
      .run(decision === 'approved' ? 'running' : 'failed', decision === 'approved' ? (step.next ?? step.id) : step.id,
        decision === 'approved' ? '' : '本人が承認しませんでした', timestamp, runId)
  })
  return runRow(db, runId)!
}

export function getWorkflowRun(db: DatabaseSync, runId: string): {
  run: WorkflowRunRecord
  steps: WorkflowStepRunRecord[]
  approval?: { stepId: string; actionHash: string; action: unknown; status: string; requestedAt: string; decidedAt: string }
} {
  const run = runRow(db, runId)
  if (!run) throw new Error(`workflow runがありません: ${runId}`)
  const steps = db.prepare(`SELECT run_id AS runId, step_id AS stepId, owner, status,
    input_hash AS inputHash, output_hash AS outputHash, output_ref AS outputRef,
    last_error AS lastError, started_at AS startedAt, finished_at AS finishedAt, updated_at AS updatedAt
    FROM workflow_step_run WHERE run_id = ? ORDER BY rowid`).all(runId) as WorkflowStepRunRecord[]
  const approval = db.prepare(`SELECT step_id AS stepId, action_hash AS actionHash, action_json AS actionJson,
    status, requested_at AS requestedAt, decided_at AS decidedAt FROM workflow_approval
    WHERE run_id = ? ORDER BY requested_at DESC LIMIT 1`).get(runId) as
    { stepId: string; actionHash: string; actionJson: string; status: string; requestedAt: string; decidedAt: string } | undefined
  return {
    run,
    steps,
    approval: approval ? {
      stepId: approval.stepId,
      actionHash: approval.actionHash,
      action: JSON.parse(approval.actionJson),
      status: approval.status,
      requestedAt: approval.requestedAt,
      decidedAt: approval.decidedAt,
    } : undefined,
  }
}
