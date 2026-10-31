/**
 * 採用ポータル等のブラウザ操作を、Agentの自由入力から切り離す安全契約。
 *
 * この層は実サイトadapterではない。承認済みactionから値を解決し、決定論的な
 * BrowserDriverへ渡す前に、正本・承認・冪等性・再照合・遷移先を検査する。
 */
import { workflowHash } from './workflow-control.js'

export const BROWSER_STEP_TYPES = ['navigate', 'assert', 'fill', 'click', 'wait', 'checkpoint', 'commit'] as const
export type BrowserStepType = (typeof BROWSER_STEP_TYPES)[number]

export interface BrowserNavigateStep { type: 'navigate'; url: string }
export interface BrowserAssertStep {
  type: 'assert'
  selector: string
  condition: 'visible' | 'enabled' | 'checked' | 'text-equals-approved'
  valueRef?: string
}
export interface BrowserFillStep { type: 'fill'; selector: string; valueRef: string }
export interface BrowserClickStep { type: 'click'; selector: string }
export interface BrowserWaitStep { type: 'wait'; selector: string; state: 'visible' | 'hidden'; timeoutMs: number }
export interface BrowserCheckpointStep {
  type: 'checkpoint'
  kind: 'authentication' | 'mfa' | 'captcha' | 'identity' | 'terms' | 'manual-review'
  message: string
}
export interface BrowserCommitStep {
  type: 'commit'
  selector: string
  action: 'submit' | 'confirm' | 'send' | 'reserve' | 'withdraw'
}
export type BrowserPlanStep = BrowserNavigateStep | BrowserAssertStep | BrowserFillStep | BrowserClickStep
  | BrowserWaitStep | BrowserCheckpointStep | BrowserCommitStep

export interface BrowserOperationPlan {
  schemaVersion: 1
  id: string
  effect: 'none' | 'third-party-commit'
  target: { origin: string; pathPrefix: string }
  database: { id: string; role: 'canonical' }
  actionHash: string
  externalIdempotencyKey: string
  steps: BrowserPlanStep[]
}

export interface BrowserDriverContext {
  /** fill/assertのときだけ設定される。ログへ保存してはならない。 */
  approvedValue?: string | number | boolean
  externalIdempotencyKey: string
}
export interface BrowserDriverResult {
  state: 'ok' | 'needs_user' | 'unknown'
  reason?: string
}
export interface BrowserDriver {
  run(step: Exclude<BrowserPlanStep, BrowserCheckpointStep>, context: BrowserDriverContext): Promise<BrowserDriverResult>
}

export interface BrowserPlanSummaryStep {
  index: number
  type: BrowserStepType
  selectorHash?: string
  path?: string
  checkpoint?: BrowserCheckpointStep['kind']
  action?: BrowserCommitStep['action']
}
export interface BrowserPlanSummary {
  planId: string
  planHash: string
  actionHash: string
  effect: BrowserOperationPlan['effect']
  targetOrigin: string
  targetPathPrefix: string
  stepCount: number
  steps: BrowserPlanSummaryStep[]
}

export interface BrowserPlanRunRequest {
  plan: BrowserOperationPlan
  mode: 'dry-run' | 'execute'
  driver?: BrowserDriver
  approvedAction?: unknown
  approvedActionHash?: string
  databaseIdentity?: { id: string; role: string }
  reconciliation?: { state: 'not_done' | 'done' | 'unknown'; receiptRef?: string }
}
export type BrowserPlanRunResult =
  | { status: 'dry_run'; summary: BrowserPlanSummary }
  | { status: 'completed'; summary: BrowserPlanSummary; needsReconcile: false }
  | { status: 'already_done'; summary: BrowserPlanSummary; receiptRef?: string; needsReconcile: false }
  | { status: 'needs_user'; summary: BrowserPlanSummary; checkpoint: string; needsReconcile: false }
  | { status: 'unknown'; summary: BrowserPlanSummary; reason: 'driver_unknown' | 'driver_failed'; needsReconcile: true }

const HASH = /^[a-f0-9]{64}$/
const IDENTIFIER = /^[a-z0-9][a-z0-9._:-]{0,127}$/
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/
const POINTER = /^(?:\/(?:[^~/]|~[01])*)+$/
const SENSITIVE = /password|passwd|passcode|secret|token|api[_-]?key|cookie|session|credential|otp/i
const SELECTOR = /^[A-Za-z0-9_#.[\]="': -]+$/

function objectKeys(value: unknown): string[] {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value as Record<string, unknown>) : []
}

function onlyKeys(value: unknown, allowed: readonly string[], label: string, errors: string[]): void {
  for (const key of objectKeys(value)) if (!allowed.includes(key)) errors.push(`${label}: 未知の項目です: ${key}`)
}

function safeText(value: unknown, label: string, errors: string[], max = 200): value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\r\n\0]/.test(value)) {
    errors.push(`${label}が不正です`)
    return false
  }
  return true
}

function selectorOk(value: unknown, label: string, errors: string[]): value is string {
  if (!safeText(value, label, errors, 300)) return false
  if (!SELECTOR.test(value) || SENSITIVE.test(value)) {
    errors.push(`${label}は許可された非機密selectorではありません`)
    return false
  }
  return true
}

function pointerOk(value: unknown, label: string, errors: string[]): value is string {
  if (!safeText(value, label, errors, 300)) return false
  if (!POINTER.test(value) || SENSITIVE.test(value.replaceAll('~1', '/').replaceAll('~0', '~'))) {
    errors.push(`${label}は許可された非機密JSON Pointerではありません`)
    return false
  }
  return true
}

function normalizedTarget(plan: BrowserOperationPlan, errors: string[]): { origin: string; prefix: string } | null {
  try {
    const parsed = new URL(plan.target.origin)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/'
      || parsed.search || parsed.hash || parsed.origin !== plan.target.origin) {
      errors.push('target.originはuserinfo・path・query・fragmentを含まないHTTPS originが必要です')
    }
    const prefix = plan.target.pathPrefix
    if (!prefix.startsWith('/') || prefix.startsWith('//') || /[?#\\]/.test(prefix)
      || /%(?:2e|2f|5c)/i.test(prefix) || prefix.split('/').includes('..')) {
      errors.push('target.pathPrefixが不正です')
    }
    return { origin: parsed.origin, prefix }
  } catch {
    errors.push('target.originがURLではありません')
    return null
  }
}

function validateNavigation(url: unknown, target: { origin: string; prefix: string } | null, label: string, errors: string[]): void {
  if (!safeText(url, label, errors, 2_000) || !target) return
  try {
    if (/%(?:2e|2f|5c)/i.test(url)) throw new Error('encoded traversal')
    const parsed = new URL(url)
    const prefix = target.prefix === '/' ? '/' : target.prefix.replace(/\/$/, '')
    const withinPrefix = prefix === '/' || parsed.pathname === prefix || parsed.pathname.startsWith(prefix + '/')
    if (parsed.protocol !== 'https:' || parsed.origin !== target.origin || parsed.username || parsed.password
      || parsed.search || parsed.hash || !withinPrefix) throw new Error('outside target')
  } catch {
    errors.push(`${label}は許可origin・pathPrefix内のqueryなしHTTPS URLが必要です`)
  }
}

/** Plan自体を厳格検証する。未知の操作は許可しない。 */
export function validateBrowserPlan(plan: BrowserOperationPlan): void {
  const errors: string[] = []
  onlyKeys(plan, ['schemaVersion', 'id', 'effect', 'target', 'database', 'actionHash', 'externalIdempotencyKey', 'steps'], 'plan', errors)
  if (plan.schemaVersion !== 1) errors.push('schemaVersionは1のみ対応しています')
  if (typeof plan.id !== 'string' || !IDENTIFIER.test(plan.id)) errors.push('plan.idが不正です')
  if (!['none', 'third-party-commit'].includes(plan.effect)) errors.push('effectが不正です')
  onlyKeys(plan.target, ['origin', 'pathPrefix'], 'target', errors)
  const target = normalizedTarget(plan, errors)
  onlyKeys(plan.database, ['id', 'role'], 'database', errors)
  if (typeof plan.database?.id !== 'string' || !IDENTIFIER.test(plan.database.id) || plan.database?.role !== 'canonical') {
    errors.push('databaseにはcanonicalな正本identityが必要です')
  }
  if (typeof plan.actionHash !== 'string' || !HASH.test(plan.actionHash)) errors.push('actionHashはSHA-256が必要です')
  if (typeof plan.externalIdempotencyKey !== 'string' || !IDEMPOTENCY_KEY.test(plan.externalIdempotencyKey)) {
    errors.push('外部冪等キーが不正です')
  }
  if (!Array.isArray(plan.steps) || plan.steps.length === 0 || plan.steps.length > 100) {
    errors.push('stepsは1〜100件が必要です')
  }

  let commits = 0
  for (const [index, raw] of (Array.isArray(plan.steps) ? plan.steps : []).entries()) {
    const step = raw as BrowserPlanStep
    const label = `steps[${index}]`
    if (!step || typeof step !== 'object' || !BROWSER_STEP_TYPES.includes(step.type)) {
      errors.push(`${label}: 未知の操作です`)
      continue
    }
    if (step.type === 'navigate') {
      onlyKeys(step, ['type', 'url'], label, errors)
      validateNavigation(step.url, target, `${label}.url`, errors)
    } else if (step.type === 'assert') {
      onlyKeys(step, ['type', 'selector', 'condition', 'valueRef'], label, errors)
      selectorOk(step.selector, `${label}.selector`, errors)
      if (!['visible', 'enabled', 'checked', 'text-equals-approved'].includes(step.condition)) errors.push(`${label}.conditionが不正です`)
      if (step.condition === 'text-equals-approved') pointerOk(step.valueRef, `${label}.valueRef`, errors)
      else if (step.valueRef !== undefined) errors.push(`${label}.valueRefは承認値との照合時だけ指定できます`)
    } else if (step.type === 'fill') {
      onlyKeys(step, ['type', 'selector', 'valueRef'], label, errors)
      selectorOk(step.selector, `${label}.selector`, errors)
      pointerOk(step.valueRef, `${label}.valueRef`, errors)
    } else if (step.type === 'click') {
      onlyKeys(step, ['type', 'selector'], label, errors)
      selectorOk(step.selector, `${label}.selector`, errors)
    } else if (step.type === 'wait') {
      onlyKeys(step, ['type', 'selector', 'state', 'timeoutMs'], label, errors)
      selectorOk(step.selector, `${label}.selector`, errors)
      if (!['visible', 'hidden'].includes(step.state)) errors.push(`${label}.stateが不正です`)
      if (!Number.isInteger(step.timeoutMs) || step.timeoutMs < 0 || step.timeoutMs > 10_000) errors.push(`${label}.timeoutMsが不正です`)
    } else if (step.type === 'checkpoint') {
      onlyKeys(step, ['type', 'kind', 'message'], label, errors)
      if (!['authentication', 'mfa', 'captcha', 'identity', 'terms', 'manual-review'].includes(step.kind)) errors.push(`${label}.kindが不正です`)
      safeText(step.message, `${label}.message`, errors, 200)
    } else if (step.type === 'commit') {
      onlyKeys(step, ['type', 'selector', 'action'], label, errors)
      selectorOk(step.selector, `${label}.selector`, errors)
      if (!['submit', 'confirm', 'send', 'reserve', 'withdraw'].includes(step.action)) errors.push(`${label}.actionが不正です`)
      commits++
      if (index !== plan.steps.length - 1) errors.push('commitは最後のstepだけに置けます')
    }
  }
  if (plan.effect === 'third-party-commit' && commits !== 1) errors.push('第三者確定planには最後のcommitが1件必要です')
  if (plan.effect === 'none' && commits !== 0) errors.push('副作用なしplanにcommitは置けません')
  if (commits > 1) errors.push('commitは最大1件です')
  if (errors.length) throw new Error(`ブラウザ操作計画を拒否しました:\n- ${errors.join('\n- ')}`)
}

function selectorHash(selector: string): string {
  return workflowHash(selector).slice(0, 16)
}

/** 値・生selectorを含まないレビュー用summaryを作る。 */
export function summarizeBrowserPlan(plan: BrowserOperationPlan): BrowserPlanSummary {
  validateBrowserPlan(plan)
  return {
    planId: plan.id,
    planHash: workflowHash(plan),
    actionHash: plan.actionHash,
    effect: plan.effect,
    targetOrigin: plan.target.origin,
    targetPathPrefix: plan.target.pathPrefix,
    stepCount: plan.steps.length,
    steps: plan.steps.map((step, index) => ({
      index,
      type: step.type,
      ...('selector' in step ? { selectorHash: selectorHash(step.selector) } : {}),
      ...(step.type === 'navigate' ? { path: new URL(step.url).pathname } : {}),
      ...(step.type === 'checkpoint' ? { checkpoint: step.kind } : {}),
      ...(step.type === 'commit' ? { action: step.action } : {}),
    })),
  }
}

function cloneAndFreeze<T>(value: T): T {
  const clone = structuredClone(value)
  const freeze = (item: unknown): void => {
    if (!item || typeof item !== 'object' || Object.isFrozen(item)) return
    for (const child of Object.values(item as Record<string, unknown>)) freeze(child)
    Object.freeze(item)
  }
  freeze(clone)
  return clone
}

function approvedValue(action: unknown, pointer: string): string | number | boolean {
  const parts = pointer.slice(1).split('/').map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
  let value: unknown = action
  for (const part of parts) {
    if (!value || typeof value !== 'object' || !(part in value)) throw new Error(`承認actionにvalueRefが存在しません: ${pointer}`)
    value = (value as Record<string, unknown>)[part]
  }
  if (!['string', 'number', 'boolean'].includes(typeof value)) throw new Error(`valueRefはscalar値だけを参照できます: ${pointer}`)
  return value as string | number | boolean
}

function validateExecution(request: BrowserPlanRunRequest): { action: unknown; driver: BrowserDriver } {
  const { plan } = request
  if (!request.driver) throw new Error('executeにはBrowserDriverが必要です')
  if (request.approvedAction === undefined || workflowHash(request.approvedAction) !== plan.actionHash
    || request.approvedActionHash !== plan.actionHash) throw new Error('承認済みaction hashが一致しません')
  if (!request.databaseIdentity || request.databaseIdentity.id !== plan.database.id
    || request.databaseIdentity.role !== 'canonical') throw new Error('正本DB identityが一致しません')
  if (!request.reconciliation) throw new Error('事前reconcile結果が必要です')
  return { action: cloneAndFreeze(request.approvedAction), driver: request.driver }
}

/**
 * dry-runはDriverを一度も呼ばない。executeは再照合後に1回だけ順番どおり実行し、
 * 不明な成否では自動再試行せずneedsReconcileを返す。
 */
export async function runBrowserPlan(request: BrowserPlanRunRequest): Promise<BrowserPlanRunResult> {
  const summary = summarizeBrowserPlan(request.plan)
  if (request.mode === 'dry-run') return { status: 'dry_run', summary }
  const { action, driver } = validateExecution(request)
  if (request.reconciliation!.state === 'done') {
    return { status: 'already_done', summary, receiptRef: request.reconciliation!.receiptRef, needsReconcile: false }
  }
  if (request.reconciliation!.state === 'unknown') throw new Error('外部操作の成否が不明なため実行しません')

  for (const step of request.plan.steps) {
    if (step.type === 'checkpoint') {
      return { status: 'needs_user', summary, checkpoint: step.kind, needsReconcile: false }
    }
    const valueRef = step.type === 'fill' || (step.type === 'assert' && step.condition === 'text-equals-approved')
      ? step.valueRef : undefined
    const context: BrowserDriverContext = {
      externalIdempotencyKey: request.plan.externalIdempotencyKey,
      ...(valueRef ? { approvedValue: approvedValue(action, valueRef) } : {}),
    }
    try {
      const result = await driver.run(step, context)
      if (result.state === 'needs_user') {
        return { status: 'needs_user', summary, checkpoint: result.reason || 'driver-checkpoint', needsReconcile: false }
      }
      if (result.state === 'unknown') {
        return { status: 'unknown', summary, reason: 'driver_unknown', needsReconcile: true }
      }
    } catch {
      return { status: 'unknown', summary, reason: 'driver_failed', needsReconcile: true }
    }
  }
  return { status: 'completed', summary, needsReconcile: false }
}
