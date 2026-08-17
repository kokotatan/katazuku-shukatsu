import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { delimiter, dirname, join, resolve } from 'node:path'

export const PROVIDER_IDS = ['codex', 'claude', 'codex-oss'] as const
export type ProviderId = (typeof PROVIDER_IDS)[number]
export type AgentRisk = 'read-only' | 'db-write' | 'external-draft' | 'external-commit'
/**
 * none: 読取・構造化だけ。どのproviderでも最初から再実行できる。
 * workspace: コードや文書を同じ作業ツリーへ書く。途中変更を検査して別providerが続行できる。
 * reconcile: 外部状態を再読し、完了済み操作を照合して別providerが続行する。
 * direct: DB・メール・予定・応募など、外部結果を照合しないと再実行できない。
 */
export type SideEffectMode = 'none' | 'workspace' | 'reconcile' | 'direct'
export type FailureCode =
  | 'command_missing'
  | 'auth_unavailable'
  | 'quota_exhausted'
  | 'rate_limited'
  | 'connection_failed'
  | 'capability_missing'
  | 'invalid_output'
  | 'timeout'
  | 'partial_side_effect'
  | 'user_action_required'
  | 'runtime_error'

export interface AgentRunRequest {
  runId: string
  workflowId: string
  prompt: string
  cwd: string
  capabilities: string[]
  risk: AgentRisk
  sideEffectMode: SideEffectMode
  outputSchemaPath?: string
  providerOrder?: ProviderId[]
  timeoutMs?: number
}

export interface ProcessInvocation {
  command: string
  args: string[]
  stdin?: string
  cwd: string
  env?: NodeJS.ProcessEnv
  /** 既定の最小env(OS必須＋AIプロバイダ関連)に加えて、この子プロセスへ通したい環境変数名(#19) */
  envAllowlist?: string[]
}

export interface ProcessResult {
  exitCode: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  timedOut: boolean
  errorCode?: string
  durationMs: number
}

export type ProcessExecutor = (invocation: ProcessInvocation, timeoutMs: number) => Promise<ProcessResult>

export interface AdapterPaths {
  finalOutputPath: string
}

export interface PreflightResult {
  ok: boolean
  failure?: FailureCode
  detail?: string
}

export interface AgentAdapter {
  id: ProviderId
  capabilities: ReadonlySet<string>
  strictCapabilities: boolean
  preflight(request: AgentRunRequest, execute: ProcessExecutor): Promise<PreflightResult>
  buildInvocation(request: AgentRunRequest, paths: AdapterPaths): ProcessInvocation
  readOutput(result: ProcessResult, paths: AdapterPaths): Promise<string>
  detectPossibleSideEffect(result: ProcessResult): boolean
}

export interface AgentAttempt {
  attemptId: string
  provider: ProviderId
  phase: 'preflight' | 'running' | 'validating'
  status: 'failed' | 'succeeded' | 'skipped'
  failure?: FailureCode
  safeToFallback: boolean
  startedAt: string
  finishedAt: string
  exitCode?: number | null
  stdoutRef?: string
  stderrRef?: string
  outputRef?: string
}

export interface AgentRunResult {
  runId: string
  workflowId: string
  status: 'succeeded' | 'failed' | 'needs_resume'
  provider?: ProviderId
  sideEffectState: 'none' | 'workspace' | 'committed' | 'unknown'
  safeToFallback: boolean
  output?: string
  outputRef?: string
  failure?: FailureCode
  attempts: AgentAttempt[]
}

export interface RunAgentOptions {
  adapters: AgentAdapter[]
  artifactDir: string
  healthFile?: string
  quotaCooldownMs?: number
  execute?: ProcessExecutor
  now?: () => Date
}

export interface ProviderHealthEntry {
  failure: 'quota_exhausted'
  detectedAt: string
  unavailableUntil: string
  resetHint?: string
}

export interface ProviderHealthDocument {
  schemaVersion: 1
  providers: Partial<Record<ProviderId, ProviderHealthEntry>>
}

const BASE_CAPABILITIES = ['workspace.read', 'workspace.write', 'shell']
const CLAUDE_EXTRA_CAPABILITIES = [
  'web.search',
  'gmail.read',
  'gmail.draft',
  'gmail.labels',
  'gmail.send',
  'calendar.read',
  'calendar.write',
  'drive.read',
  'sheets.read',
  'sheets.write',
  'browser.interact',
  'voice.transcribe',
]

/**
 * capability を Claude CLI の `--allowedTools` へ写す既定の対応表。
 *
 * MCPサーバ名(`mcp__google-workspace__*` など)は**どのMCPを入れているかという環境の話**で、
 * core が知っているべきことではない。既定として持つが、`AdapterOptions.capabilityTools` で
 * 丸ごと差し替えられる。自分の環境の名前に読み替えるときはそちらを使うこと。
 */
export const DEFAULT_CAPABILITY_TOOLS: Record<string, string[]> = {
  'workspace.read': ['Read', 'Glob', 'Grep'],
  'workspace.write': ['Write', 'Edit'],
  shell: ['PowerShell'],
  'web.search': ['WebSearch', 'WebFetch'],
  'gmail.read': ['mcp__claude_ai_Gmail__*', 'mcp__google-workspace__*gmail*'],
  'gmail.draft': ['mcp__claude_ai_Gmail__*', 'mcp__google-workspace__*gmail*'],
  'gmail.labels': ['mcp__claude_ai_Gmail__*', 'mcp__google-workspace__*gmail*'],
  'gmail.send': ['mcp__claude_ai_Gmail__*', 'mcp__google-workspace__*gmail*'],
  'calendar.read': ['mcp__claude_ai_Google_Calendar__*', 'mcp__google-workspace__*calendar*'],
  'calendar.write': ['mcp__claude_ai_Google_Calendar__*', 'mcp__google-workspace__*calendar*'],
  'drive.read': ['mcp__claude_ai_Google_Drive__*', 'mcp__google-workspace__*drive*'],
  'sheets.read': ['mcp__claude_ai_Google_Drive__*', 'mcp__google-workspace__*sheet*'],
  'sheets.write': ['mcp__claude_ai_Google_Drive__*', 'mcp__google-workspace__*sheet*'],
  'browser.interact': ['mcp__claude-in-chrome__*', 'mcp__claude_ai_Chrome__*'],
  'voice.transcribe': ['mcp__voicebox__*'],
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

export function parseProviderOrder(value?: string): ProviderId[] {
  const values = (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  const invalid = values.filter((item) => !PROVIDER_IDS.includes(item as ProviderId))
  if (invalid.length) throw new Error('未知のproviderです: ' + invalid.join(', '))
  const order = unique(values as ProviderId[])
  return order.length ? order : ['claude', 'codex', 'codex-oss']
}

/**
 * Claude CLIは週制限の使用率が閾値を超えた時点で rate_limit_event を出すが、これは
 * `status: "allowed_warning"`(まだ使える警告)と実際の停止の両方に使われる。
 * 警告を停止と読むと、枠が残っているのにproviderを復活日まで締め出してしまう
 * (2026-07-30: utilization 0.82 の警告だけでClaudeを8/2まで遮断し、asa/daily-syncが3日間停止した)。
 * よって seven_day の rate limit は status が allowed 系でないときだけ枠切れと見なす。
 * textは小文字化済み(JSONのキー・値も小文字)である前提。
 */
function hasBlockingRateLimitEvent(text: string): boolean {
  const events = text.matchAll(/"rate_limit_info"\s*:\s*\{([^}]*)\}/g)
  for (const event of events) {
    const body = event[1]
    if (!/seven_day/.test(body)) continue
    const status = body.match(/"status"\s*:\s*"([^"]*)"/)?.[1] ?? ''
    if (!status.startsWith('allowed')) return true
  }
  return false
}

function classifyKnownFailure(result: ProcessResult): FailureCode | undefined {
  if (result.errorCode === 'ENOENT') return 'command_missing'
  if (result.timedOut) return 'timeout'
  const text = (result.stderr + '\n' + result.stdout).toLowerCase()
  // CLIの引数解釈に失敗した(clap等の usage エラー)。invocationが現行CLIの形と合っていないだけで、
  // モデル・ツールは一切動いておらず副作用は起きえない。command_missing相当の安全な起動前失敗として扱う。
  if (/unexpected argument|unrecognized (option|argument|subcommand)|invalid value for|for more information, try '--help'/.test(text)) {
    return 'command_missing'
  }
  if (
    /weekly limit|usage limit|quota( has been)? exceeded|credit balance|out of extra usage|maximum.*usage/.test(text) ||
    hasBlockingRateLimitEvent(text)
  ) {
    return 'quota_exhausted'
  }
  if (/rate.?limit|too many requests|\b429\b/.test(text)) return 'rate_limited'
  if (/not logged in|login required|authentication|unauthorized|invalid api key|access token.*invalid|\b401\b/.test(text)) {
    return 'auth_unavailable'
  }
  if (/mcp.*(missing|not found|unavailable)|tool.*(missing|not found|not available)|capabilit.*missing/.test(text)) {
    return 'capability_missing'
  }
  if (/connection refused|unable to connect|network.*unavailable|dns|econnrefused|etimedout|failed to initialize.*app-server/.test(text)) {
    return 'connection_failed'
  }
  if (/captcha|multi-factor|two-factor|mfa|required user action|本人確認/.test(text)) {
    return 'user_action_required'
  }
  return undefined
}

export function classifyFailure(result: ProcessResult): FailureCode {
  return classifyKnownFailure(result) ?? 'runtime_error'
}

/**
 * 一部CLIは利用枠切れを終了コード0で返すことがある。高確度の既知文言は終了コードに
 * 関係なく失敗とし、それ以外の正常終了だけを成功として扱う。
 */
/**
 * 「副作用を起こす前に、agent自身が中止を宣言した」と読み取るパターンの既定値。
 *
 * これはプロンプト規約の話であって、provider契約の話ではない(#8)。日本語の文言を
 * core に焼き込みたくないので、既定として持ちつつ `detectProcessFailure` の第2引数で
 * 差し替えられるようにしてある。自分のプロンプト規約に合わせて置き換えること。
 */
export const DEFAULT_ABORT_PATTERNS: RegExp[] = [/MCP\s*が使えないため中止|MCPが使えないため中止/]

export function detectProcessFailure(
  result: ProcessResult,
  abortPatterns: RegExp[] = DEFAULT_ABORT_PATTERNS,
): FailureCode | undefined {
  const known = classifyKnownFailure(result)
  if (result.exitCode === 0 && !result.signal && !result.errorCode) {
    // Codexは途中で回復したtool errorもJSON eventへ残す。最終終了が成功なら、それを
    // capability/auth失敗へ誤分類しない。終了コード0でも失敗扱いするのは、実測済みの利用枠切れと、
    // プロンプト規約が定める明示の中止宣言(例: daily-syncの「Gmail MCP が使えないため中止」)だけ。
    // 後者はagent自身が「何もしていない」と宣言しているため、次のproviderへ安全に回せる
    // (2026-07-28: Claude headlessのMCP未接続中止が終了コード0で成功扱いになり、
    //  MCPを持つCodexが居るのに引き継がれず日次同期が無音で止まった)。
    if (known === 'quota_exhausted') return known
    const output = `${result.stderr}\n${result.stdout}`
    if (abortPatterns.some((pattern) => pattern.test(output))) {
      return 'capability_missing'
    }
    return undefined
  }
  if (known) return known
  return 'runtime_error'
}

const SAFE_START_FAILURES = new Set<FailureCode>([
  'command_missing',
  'auth_unavailable',
  'quota_exhausted',
  'rate_limited',
  'connection_failed',
  'capability_missing',
])

export function mayFallback(params: {
  failure: FailureCode
  phase: AgentAttempt['phase']
  sideEffectMode: SideEffectMode
  possibleSideEffect: boolean
}): boolean {
  if (params.phase === 'preflight') return true
  if (params.sideEffectMode === 'none') return params.failure !== 'user_action_required'
  if (params.sideEffectMode === 'workspace') {
    return params.failure !== 'user_action_required' && params.failure !== 'partial_side_effect'
  }
  if (params.sideEffectMode === 'reconcile') return params.failure !== 'user_action_required'
  return !params.possibleSideEffect && SAFE_START_FAILURES.has(params.failure)
}

const MONTHS = new Map([
  ['jan', 0], ['feb', 1], ['mar', 2], ['apr', 3], ['may', 4], ['jun', 5],
  ['jul', 6], ['aug', 7], ['sep', 8], ['oct', 9], ['nov', 10], ['dec', 11],
])

function zonedParts(date: Date, timeZone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  return Object.fromEntries(parts
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, Number(part.value)]))
}

function zonedDateToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const desired = Date.UTC(year, month, day, hour, minute)
  let guess = desired
  // DST境界でも収束するよう、推定したoffsetを2回補正する。
  for (let index = 0; index < 2; index += 1) {
    const parts = zonedParts(new Date(guess), timeZone)
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
    guess = desired - (represented - guess)
  }
  return new Date(guess)
}

function parseClock(hourText: string, minuteText: string | undefined, meridiem: string): {
  hour: number
  minute: number
} {
  let hour = Number(hourText) % 12
  if (meridiem.toLowerCase() === 'pm') hour += 12
  return { hour, minute: Number(minuteText ?? 0) }
}

/**
 * Claude CLIの例:
 *   You've hit your weekly limit · resets Jul 26, 9pm (Asia/Tokyo)
 * 復活時刻が読めない版ではundefinedを返し、呼出側が保守的なcooldownを使う。
 */
export function parseQuotaResetAt(text: string, now: Date = new Date()): Date | undefined {
  const epoch = text.match(/resetsAt[^0-9]{0,8}(\d{9,13})/i)
  if (epoch) {
    const numeric = Number(epoch[1])
    const parsed = new Date(numeric >= 1_000_000_000_000 ? numeric : numeric * 1000)
    if (Number.isFinite(parsed.getTime()) && parsed.getTime() > now.getTime()) return parsed
  }
  const dated = text.match(
    /\bresets?\s+([a-z]{3})\s+(\d{1,2}),?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?:\s+\(([^)]+)\))?/i,
  )
  if (!dated) return undefined
  const month = MONTHS.get(dated[1].toLowerCase())
  if (month === undefined) return undefined
  const timeZone = dated[6] || Intl.DateTimeFormat().resolvedOptions().timeZone
  try {
    const currentYear = zonedParts(now, timeZone).year
    const clock = parseClock(dated[3], dated[4], dated[5])
    let candidate = zonedDateToUtc(currentYear, month, Number(dated[2]), clock.hour, clock.minute, timeZone)
    if (candidate.getTime() <= now.getTime()) {
      candidate = zonedDateToUtc(currentYear + 1, month, Number(dated[2]), clock.hour, clock.minute, timeZone)
    }
    return candidate
  } catch {
    return undefined
  }
}

function quotaResetHint(text: string): string | undefined {
  const hint = text.match(/\bresets?\s+[^\r\n]{1,80}/i)?.[0]
  return hint ? redact(hint) : undefined
}

async function readProviderHealth(path: string): Promise<ProviderHealthDocument> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as ProviderHealthDocument
    if (parsed.schemaVersion === 1 && parsed.providers && typeof parsed.providers === 'object') return parsed
  } catch {
    // 初回、または壊れたローカル状態は空として安全側に再生成する。
  }
  return { schemaVersion: 1, providers: {} }
}

async function writeProviderHealth(path: string, health: ProviderHealthDocument): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(health, null, 2) + '\n', 'utf8')
}

function continuationRequest(
  request: AgentRunRequest,
  attempts: AgentAttempt[],
): AgentRunRequest {
  if (request.sideEffectMode !== 'workspace' && request.sideEffectMode !== 'reconcile') return request
  const interrupted = attempts.filter((attempt) =>
    (attempt.phase === 'running' || attempt.phase === 'validating') && attempt.status === 'failed')
  if (!interrupted.length) return request
  const summary = interrupted
    .map((attempt) => `${attempt.provider}:${attempt.failure ?? 'runtime_error'}`)
    .join(', ')
  const guidance = request.sideEffectMode === 'workspace'
    ? [
        '前のproviderが同じ作業ツリーで途中まで作業した可能性があります。',
        '既存変更はユーザーまたは前のproviderの成果として保持し、まず作業ツリー、差分、関連ファイル、テスト結果を確認してください。',
        '最初から機械的にやり直さず、未完了部分だけを続行して、元の完了条件まで仕上げてください。',
      ]
    : [
        '前のproviderが外部操作を途中まで実行した可能性があります。',
        '最初にGmail、Calendar、Drive、DB、作業ファイルなど依頼対象の現在状態を再取得してください。',
        '同じ宛先・件名・予定時刻・sourceRef・runId等で完了済みの操作は繰り返さず、未完了部分だけを続行してください。',
        '送信・作成結果が判別できない場合も、履歴・下書き・予定一覧を検索してから判断してください。',
      ]
  return {
    ...request,
    prompt: [
      ...guidance,
      `中断記録: ${summary}`,
      '',
      '元の依頼:',
      request.prompt,
    ].join('\n'),
  }
}

function safeSegment(value: string): string {
  const normalized = value.normalize('NFKC').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  if (normalized) return normalized.slice(0, 80)
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

function redact(text: string): string {
  return text
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_API_KEY]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/((?:API_KEY|TOKEN|SECRET|PASSWORD)\s*[=:]\s*)[^\s"']+/gi, '$1[REDACTED]')
}

function quoteForCmd(value: string): string {
  return '"' + value.replace(/"/g, '""') + '"'
}

/**
 * spawnする子プロセスへ渡す環境を最小化する(#19)。ホストの全環境を丸ごと継承させると、
 * 無関係な認証情報(AWS/DB/他サービスのキー等)まで provider の子プロセスから見えてしまう。
 * OS動作に必要な変数と、AIプロバイダ関連(ANTHROPIC_/OPENAI_ 等)・プロキシだけを通す。
 * 追加で通したい変数は invocation.envAllowlist で明示する(既定は最小)。
 */
export const ESSENTIAL_ENV = new Set([
  'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SystemDrive', 'windir', 'ComSpec',
  'TEMP', 'TMP', 'TMPDIR', 'HOME', 'HOMEDRIVE', 'HOMEPATH', 'USERPROFILE', 'USERNAME',
  'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432',
  'LANG', 'LC_ALL', 'TZ', 'NODE_OPTIONS', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME',
])
const PROVIDER_ENV_RE = /^(ANTHROPIC|CLAUDE|CODEX|OPENAI|AZURE_OPENAI|GOOGLE|GEMINI|VERTEX|MISTRAL|COHERE|GROQ|XAI|OLLAMA)_|^(HTTP_PROXY|HTTPS_PROXY|NO_PROXY|ALL_PROXY)$/i

export function buildProviderEnv(invocationEnv?: NodeJS.ProcessEnv, allowlist: string[] = []): NodeJS.ProcessEnv {
  const allow = new Set([...ESSENTIAL_ENV, ...allowlist])
  const out: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (allow.has(key) || PROVIDER_ENV_RE.test(key)) out[key] = value
  }
  return { ...out, ...invocationEnv }
}

export const executeProcess: ProcessExecutor = async (invocation, timeoutMs) => {
  const started = Date.now()
  let command = invocation.command
  let args = invocation.args
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)) {
    const shell = process.env.ComSpec || 'cmd.exe'
    const line = [quoteForCmd(command), ...args.map(quoteForCmd)].join(' ')
    command = shell
    args = ['/d', '/s', '/c', line]
  }
  return await new Promise<ProcessResult>((done) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    let timer: NodeJS.Timeout | undefined
    const finish = (partial: Partial<ProcessResult>) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      done({
        exitCode: partial.exitCode ?? null,
        signal: partial.signal ?? null,
        stdout,
        stderr,
        timedOut,
        errorCode: partial.errorCode,
        durationMs: Date.now() - started,
      })
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, args, {
        cwd: invocation.cwd,
        env: buildProviderEnv(invocation.env, invocation.envAllowlist),
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (error) {
      finish({ errorCode: (error as NodeJS.ErrnoException).code })
      return
    }
    timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)
    // stdio は 'pipe' で spawn しているため各ストリームは非nullだが、型上は null 許容なので明示する。
    child.stdout?.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr?.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', (error: NodeJS.ErrnoException) => finish({ errorCode: error.code }))
    child.on('close', (exitCode, signal) => finish({ exitCode, signal }))
    // spawn失敗(ENOENT)時、stdinへの書き込みがEPIPE/ENOENTを別途投げ得る。
    // プロセスの'error'とは別ストリームなので、no-opリスナーで未処理例外化を防ぐ(finishはchild.on('error')が担う)。
    child.stdin?.on('error', () => {})
    if (invocation.stdin !== undefined) child.stdin?.end(invocation.stdin)
    else child.stdin?.end()
  })
}

function schemaTypeMatches(value: unknown, type: string): boolean {
  if (type === 'null') return value === null
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value)
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value)
  return typeof value === type
}

function resolveSchemaRef(root: Record<string, unknown>, ref: string): unknown {
  if (!ref.startsWith('#/')) throw new Error('ローカルJSON Schema参照だけを利用できます: ' + ref)
  return ref.slice(2).split('/').reduce<unknown>((value, part) => {
    if (!value || typeof value !== 'object') return undefined
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~')
    return (value as Record<string, unknown>)[key]
  }, root)
}

export function validateJsonSchema(value: unknown, schema: unknown): string[] {
  const root = schema as Record<string, unknown>
  const errors: string[] = []
  const visit = (current: unknown, node: unknown, path: string): void => {
    if (node === true) return
    if (node === false) {
      errors.push(path + ': 許可されていない値です')
      return
    }
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      errors.push(path + ': schemaが不正です')
      return
    }
    const rule = node as Record<string, unknown>
    if (typeof rule.$ref === 'string') {
      visit(current, resolveSchemaRef(root, rule.$ref), path)
      return
    }
    if (Array.isArray(rule.allOf)) rule.allOf.forEach((child) => visit(current, child, path))
    if (Array.isArray(rule.anyOf)) {
      const matched = rule.anyOf.some((child) => {
        const before = errors.length
        visit(current, child, path)
        const ok = errors.length === before
        errors.splice(before)
        return ok
      })
      if (!matched) errors.push(path + ': anyOfのどのschemaにも一致しません')
      return
    }
    if (Array.isArray(rule.oneOf)) {
      const matches = rule.oneOf.filter((child) => {
        const before = errors.length
        visit(current, child, path)
        const matched = errors.length === before
        errors.splice(before)
        return matched
      }).length
      if (matches !== 1) errors.push(path + ': oneOfは1件だけ一致する必要があります')
      return
    }
    if ('const' in rule && !Object.is(current, rule.const)) errors.push(path + ': constと一致しません')
    if (Array.isArray(rule.enum) && !rule.enum.some((item) => Object.is(item, current))) {
      errors.push(path + ': enumに含まれません')
    }
    const types = typeof rule.type === 'string' ? [rule.type] : Array.isArray(rule.type) ? rule.type as string[] : []
    if (types.length && !types.some((type) => schemaTypeMatches(current, type))) {
      errors.push(path + ': 型が' + types.join('|') + 'ではありません')
      return
    }
    if (typeof current === 'string') {
      if (typeof rule.minLength === 'number' && current.length < rule.minLength) errors.push(path + ': 文字数が短すぎます')
      if (typeof rule.maxLength === 'number' && current.length > rule.maxLength) errors.push(path + ': 文字数が長すぎます')
      if (typeof rule.pattern === 'string' && !new RegExp(rule.pattern).test(current)) errors.push(path + ': patternに一致しません')
    }
    if (typeof current === 'number') {
      if (typeof rule.minimum === 'number' && current < rule.minimum) errors.push(path + ': minimum未満です')
      if (typeof rule.maximum === 'number' && current > rule.maximum) errors.push(path + ': maximumを超えています')
    }
    if (Array.isArray(current)) {
      if (typeof rule.minItems === 'number' && current.length < rule.minItems) errors.push(path + ': 要素数が不足しています')
      if (typeof rule.maxItems === 'number' && current.length > rule.maxItems) errors.push(path + ': 要素数が多すぎます')
      if (rule.items !== undefined) current.forEach((item, index) => visit(item, rule.items, path + '[' + index + ']'))
    }
    if (current !== null && typeof current === 'object' && !Array.isArray(current)) {
      const object = current as Record<string, unknown>
      const properties = (rule.properties ?? {}) as Record<string, unknown>
      const required = Array.isArray(rule.required) ? rule.required as string[] : []
      for (const key of required) if (!(key in object)) errors.push(path + '.' + key + ': 必須です')
      for (const [key, item] of Object.entries(object)) {
        if (key in properties) visit(item, properties[key], path + '.' + key)
        else if (rule.additionalProperties === false) errors.push(path + '.' + key + ': 未知の項目です')
        else if (rule.additionalProperties && typeof rule.additionalProperties === 'object') {
          visit(item, rule.additionalProperties, path + '.' + key)
        }
      }
    }
  }
  visit(value, schema, '$')
  return errors
}

async function validateOutput(output: string, schemaPath?: string): Promise<FailureCode | undefined> {
  if (!output.trim()) return 'invalid_output'
  if (!schemaPath) return undefined
  try {
    const value = JSON.parse(output)
    const schema = JSON.parse(await readFile(schemaPath, 'utf8'))
    return validateJsonSchema(value, schema).length ? 'invalid_output' : undefined
  } catch {
    return 'invalid_output'
  }
}

function codexPossibleSideEffect(result: ProcessResult): boolean {
  const lines = result.stdout.split(/\r?\n/).filter(Boolean)
  for (const line of lines) {
    try {
      const event = JSON.parse(line)
      const text = JSON.stringify(event).toLowerCase()
      if (/command_execution|mcp_tool|tool_call|file_change|apply_patch|browser|computer_use/.test(text)) return true
    } catch {
      return true
    }
  }
  return false
}

function claudePossibleSideEffect(result: ProcessResult): boolean {
  for (const line of result.stdout.split(/\r?\n/).filter(Boolean)) {
    try {
      const event = JSON.parse(line) as {
        type?: string
        message?: { content?: { type?: string }[] }
      }
      if (event.type === 'assistant' && event.message?.content?.some((item) => item.type === 'tool_use')) return true
      // tool_resultがある時点で対応するtoolは既に実行済み。結果が途中で欠けても安全側に倒す。
      if (event.type === 'user' && event.message?.content?.some((item) => item.type === 'tool_result')) return true
    } catch {
      // 旧CLIのtext出力は副作用有無を構造的に判定できない。
      return result.stdout.trim().length > 0
    }
  }
  return false
}

function readClaudeResult(stdout: string): string {
  const events: unknown[] = []
  for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
    try {
      events.push(JSON.parse(line))
    } catch {
      return stdout
    }
  }
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index] as {
      type?: string
      result?: unknown
      message?: { content?: { type?: string; text?: unknown }[] }
    }
    if (event.type === 'result' && typeof event.result === 'string') return event.result
    if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
      const text = event.message.content
        .filter((item) => item.type === 'text' && typeof item.text === 'string')
        .map((item) => item.text as string)
        .join('')
      if (text) return text
    }
  }
  return stdout
}

function capabilitySet(base: string[], extra?: string): Set<string> {
  return new Set([...base, ...(extra ?? '').split(',').map((value) => value.trim()).filter(Boolean)])
}

const GOOGLE_WORKSPACE_CAPABILITIES = [
  'gmail.read',
  'gmail.draft',
  'gmail.labels',
  'gmail.send',
  'calendar.read',
  'calendar.write',
  'drive.read',
  'sheets.read',
  'sheets.write',
]

async function findProjectCodexConfig(start: string): Promise<string | undefined> {
  let current = resolve(start)
  while (true) {
    const candidate = join(current, '.codex', 'config.toml')
    try {
      await access(candidate)
      return candidate
    } catch {
      const parent = dirname(current)
      if (parent === current) return undefined
      current = parent
    }
  }
}

/**
 * provider capabilityは実接続設定から保守的に推定する。秘密値やtool名は読まず、
 * MCP server sectionの存在だけを見る。実際の起動・認証失敗はadapterが分類する。
 */
export async function detectCodexExtraCapabilities(cwd: string): Promise<string[]> {
  const configPath = await findProjectCodexConfig(cwd)
  if (!configPath) return []
  try {
    const config = await readFile(configPath, 'utf8')
    const capabilities: string[] = []
    if (/^\s*\[mcp_servers\.google-workspace\]\s*$/m.test(config)) {
      capabilities.push(...GOOGLE_WORKSPACE_CAPABILITIES)
    }
    if (/^\s*\[mcp_servers\.voicebox\]\s*$/m.test(config)) {
      capabilities.push('voice.transcribe')
    }
    return unique(capabilities)
  } catch {
    return []
  }
}

function missingCapability(adapter: AgentAdapter, request: AgentRunRequest): string | undefined {
  if (!adapter.strictCapabilities) return undefined
  return request.capabilities.find((capability) => !adapter.capabilities.has(capability))
}

export interface AdapterOptions {
  command: string
  profile?: string
  model?: string
  extraCapabilities?: string
  strictCapabilities?: boolean
  localProvider?: 'ollama' | 'lmstudio'
  /** web.search capability要求時にcodex execへ渡す引数。CLI版差を吸収するためadapter内に閉じ込める */
  webSearchArgs?: string[]
  voiceboxMcpUrl?: string
  /**
   * capability → CLIツール名の対応表。省略時は `DEFAULT_CAPABILITY_TOOLS`。
   * どのMCPサーバを入れているかは環境ごとに違うので、ここで差し替える(#8)。
   */
  capabilityTools?: Record<string, string[]>
}

// 現行のcodex execは`--search`を持たず、web検索はconfig override(tools.web_search)で有効化する。
// CLIの版差でキーが変わりうるためenv KATAZUKU_CODEX_WEB_SEARCH で丸ごと差し替えられるようにする。
export const DEFAULT_CODEX_WEB_SEARCH_ARGS = ['-c', 'tools.web_search=true']

export function parseWebSearchArgs(value?: string): string[] | undefined {
  if (value === undefined) return undefined
  const tokens = value.split(/\s+/).filter(Boolean)
  return tokens.length ? tokens : []
}

export function createCodexAdapter(options: AdapterOptions, id: 'codex' | 'codex-oss' = 'codex'): AgentAdapter {
  const capabilities = capabilitySet(
    [...BASE_CAPABILITIES, 'web.search', ...(options.voiceboxMcpUrl ? ['voice.transcribe'] : [])],
    options.extraCapabilities,
  )
  const webSearchArgs = options.webSearchArgs ?? DEFAULT_CODEX_WEB_SEARCH_ARGS
  return {
    id,
    capabilities,
    strictCapabilities: options.strictCapabilities ?? true,
    async preflight(request, execute) {
      const missing = missingCapability(this, request)
      if (missing) return { ok: false, failure: 'capability_missing', detail: missing }
      const args = id === 'codex' ? ['login', 'status'] : ['--version']
      const result = await execute({ command: options.command, args, cwd: request.cwd }, 15_000)
      if (result.exitCode === 0) return { ok: true }
      return { ok: false, failure: classifyFailure(result) }
    },
    buildInvocation(request, paths) {
      const args = ['exec', '-C', request.cwd, '--color', 'never', '--json', '--output-last-message', paths.finalOutputPath]
      args.push('--sandbox', request.risk === 'read-only' ? 'read-only' : 'workspace-write')
      if (request.capabilities.includes('web.search')) args.push(...webSearchArgs)
      if (request.capabilities.includes('voice.transcribe') && options.voiceboxMcpUrl) {
        args.push('-c', `mcp_servers.voicebox.url=${JSON.stringify(options.voiceboxMcpUrl)}`)
        args.push('-c', 'mcp_servers.voicebox.http_headers={"X-Voicebox-Client-Id"="codex"}')
      }
      if (request.outputSchemaPath) args.push('--output-schema', resolve(request.outputSchemaPath))
      if (options.profile) args.push('--profile', options.profile)
      if (options.model) args.push('--model', options.model)
      if (id === 'codex-oss') args.push('--oss', '--local-provider', options.localProvider ?? 'ollama')
      args.push('-')
      return { command: options.command, args, stdin: request.prompt, cwd: request.cwd }
    },
    async readOutput(result, paths) {
      try {
        return await readFile(paths.finalOutputPath, 'utf8')
      } catch {
        return result.stdout
      }
    },
    detectPossibleSideEffect: codexPossibleSideEffect,
  }
}

export function createClaudeAdapter(options: AdapterOptions): AgentAdapter {
  const capabilities = capabilitySet([...BASE_CAPABILITIES, ...CLAUDE_EXTRA_CAPABILITIES], options.extraCapabilities)
  return {
    id: 'claude',
    capabilities,
    strictCapabilities: options.strictCapabilities ?? true,
    async preflight(request, execute) {
      const missing = missingCapability(this, request)
      if (missing) return { ok: false, failure: 'capability_missing', detail: missing }
      const result = await execute({ command: options.command, args: ['--version'], cwd: request.cwd }, 15_000)
      if (result.exitCode === 0) return { ok: true }
      return { ok: false, failure: classifyFailure(result) }
    },
    buildInvocation(request) {
      const capabilityTools = options.capabilityTools ?? DEFAULT_CAPABILITY_TOOLS
      const tools = unique(request.capabilities.flatMap((capability) => capabilityTools[capability] ?? []))
      // stream-jsonにはtool_useとrate_limit_eventが含まれる。週制限がtool実行前か後かを
      // text出力の有無で推測せず、外部副作用後の誤フォールバックを防ぐ。
      const args = ['-p', '--output-format', 'stream-json', '--verbose']
      if (tools.length) args.push('--allowedTools', ...tools)
      if (options.model) args.push('--model', options.model)
      return { command: options.command, args, stdin: request.prompt, cwd: request.cwd }
    },
    async readOutput(result) {
      return readClaudeResult(result.stdout)
    },
    detectPossibleSideEffect: claudePossibleSideEffect,
  }
}

async function findOnPath(command: string, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  if (/[\\/]/.test(command)) {
    try {
      await access(command)
      return resolve(command)
    } catch {
      return undefined
    }
  }
  const extensions = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : ['']
  for (const directory of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = join(directory, command + extension)
      try {
        await access(candidate)
        return candidate
      } catch {
        // 次の候補を調べる
      }
    }
  }
  return undefined
}

// Windowsのcodex sandboxは、codex.exeと同じ場所のcodex-command-runner.exeを制限ユーザーで起動する。
// helperがない実体(単体インストーラー版など)はCreateProcessWithLogonW failed: 2で全shell実行が失敗する
async function hasWindowsSandboxHelper(commandPath: string): Promise<boolean> {
  if (process.platform !== 'win32') return true
  if (!/[\\/]/.test(commandPath)) return false
  try {
    await access(join(dirname(commandPath), 'codex-command-runner.exe'))
    return true
  } catch {
    return false
  }
}

async function findBundledCodex(env: NodeJS.ProcessEnv): Promise<string | undefined> {
  if (process.platform !== 'win32' || !env.LOCALAPPDATA) return undefined
  const binRoot = join(env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin')
  try {
    const entries = await readdir(binRoot, { withFileTypes: true })
    const candidates: { path: string; mtimeMs: number }[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const candidate = join(binRoot, entry.name, 'codex.exe')
      try {
        candidates.push({ path: candidate, mtimeMs: (await stat(candidate)).mtimeMs })
      } catch {
        // 更新途中などで実体がないものは除外する
      }
    }
    const sorted = candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)
    for (const candidate of sorted) {
      if (await hasWindowsSandboxHelper(candidate.path)) return candidate.path
    }
    return sorted[0]?.path
  } catch {
    return undefined
  }
}

export async function resolveProviderCommands(env: NodeJS.ProcessEnv = process.env): Promise<Record<ProviderId, string>> {
  const configuredCodex = env.KATAZUKU_CODEX_COMMAND
  const configuredClaude = env.KATAZUKU_CLAUDE_COMMAND
  let codex = configuredCodex
  if (!codex) {
    const candidates = [await findOnPath('codex', env), await findBundledCodex(env)]
      .filter((item): item is string => Boolean(item))
    for (const candidate of candidates) {
      if (await hasWindowsSandboxHelper(candidate)) {
        codex = candidate
        break
      }
    }
    codex ??= candidates[0] ?? 'codex'
  }
  const claude = configuredClaude ?? await findOnPath('claude', env) ?? 'claude'
  return { codex, claude, 'codex-oss': codex }
}

export async function createDefaultAdapters(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): Promise<AgentAdapter[]> {
  const commands = await resolveProviderCommands(env)
  const detectedCodexCapabilities = await detectCodexExtraCapabilities(cwd)
  const codexExtraCapabilities = env.KATAZUKU_CODEX_CAPABILITIES !== undefined
    ? env.KATAZUKU_CODEX_CAPABILITIES
    : detectedCodexCapabilities.join(',')
  return [
    createCodexAdapter({
      command: commands.codex,
      profile: env.KATAZUKU_CODEX_PROFILE,
      model: env.KATAZUKU_CODEX_MODEL,
      extraCapabilities: codexExtraCapabilities,
      webSearchArgs: parseWebSearchArgs(env.KATAZUKU_CODEX_WEB_SEARCH),
      voiceboxMcpUrl: env.KATAZUKU_VOICEBOX_MCP_URL,
    }),
    createClaudeAdapter({
      command: commands.claude,
      model: env.KATAZUKU_CLAUDE_MODEL,
      extraCapabilities: env.KATAZUKU_CLAUDE_CAPABILITIES,
    }),
    createCodexAdapter({
      command: commands['codex-oss'],
      profile: env.KATAZUKU_CODEX_OSS_PROFILE,
      model: env.KATAZUKU_CODEX_OSS_MODEL,
      extraCapabilities: env.KATAZUKU_CODEX_OSS_CAPABILITIES,
      webSearchArgs: parseWebSearchArgs(env.KATAZUKU_CODEX_OSS_WEB_SEARCH ?? env.KATAZUKU_CODEX_WEB_SEARCH),
      localProvider: env.KATAZUKU_LOCAL_PROVIDER === 'lmstudio' ? 'lmstudio' : 'ollama',
    }, 'codex-oss'),
  ]
}

async function writeAttemptArtifacts(
  artifactDir: string,
  prefix: string,
  result: ProcessResult,
  output?: string,
): Promise<{ stdoutRef: string; stderrRef: string; outputRef?: string }> {
  const stdoutRef = join(artifactDir, prefix + '-stdout.local.log')
  const stderrRef = join(artifactDir, prefix + '-stderr.local.log')
  await writeFile(stdoutRef, redact(result.stdout), 'utf8')
  await writeFile(stderrRef, redact(result.stderr), 'utf8')
  let outputRef: string | undefined
  if (output !== undefined) {
    outputRef = join(artifactDir, prefix + '-output.local.txt')
    await writeFile(outputRef, output, 'utf8')
  }
  return { stdoutRef, stderrRef, outputRef }
}

export async function runAgent(request: AgentRunRequest, options: RunAgentOptions): Promise<AgentRunResult> {
  const execute = options.execute ?? executeProcess
  const now = options.now ?? (() => new Date())
  const order = request.providerOrder?.length ? unique(request.providerOrder) : parseProviderOrder()
  const adapters = new Map(options.adapters.map((adapter) => [adapter.id, adapter]))
  // runId を冪等キーとして排他的に確保する(#23)。ディレクトリ作成を非recursiveにして
  // EEXIST を「既に同じrunで確保済み」の合図に使う。
  // - 終端台帳(run.local.json)があれば、その結果を冪等に返す(再試行が二重起動しない)。
  // - 無ければ実行中とみなし、同時起動を拒否する(終端台帳を上書きさせない)。
  await mkdir(options.artifactDir, { recursive: true })
  const runDir = join(options.artifactDir, safeSegment(request.runId))
  try {
    await mkdir(runDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const ledger = await readFile(join(runDir, 'run.local.json'), 'utf8')
      .then((text) => JSON.parse(text) as AgentRunResult)
      .catch(() => null)
    if (ledger && ledger.status) return ledger
    throw new Error(`runId ${request.runId} は既に実行中です。二重起動を防止しました(冪等キーの衝突)。`)
  }
  const attempts: AgentAttempt[] = []
  let lastFailure: FailureCode = 'runtime_error'
  const health: ProviderHealthDocument = options.healthFile
    ? await readProviderHealth(options.healthFile)
    : { schemaVersion: 1, providers: {} }
  const quotaCooldownMs = options.quotaCooldownMs ?? 6 * 60 * 60_000

  for (let index = 0; index < order.length; index += 1) {
    const provider = order[index]
    const adapter = adapters.get(provider)
    const startedAt = now().toISOString()
    const attemptId = startedAt.replace(/[^0-9]/g, '').slice(0, 17)
      + '-' + String(index + 1).padStart(2, '0') + '-' + provider
    if (!adapter) {
      attempts.push({
        attemptId,
        provider,
        phase: 'preflight',
        status: 'skipped',
        failure: 'capability_missing',
        safeToFallback: true,
        startedAt,
        finishedAt: now().toISOString(),
      })
      lastFailure = 'capability_missing'
      continue
    }

    const healthEntry = health.providers[provider]
    if (healthEntry?.failure === 'quota_exhausted') {
      const unavailableUntil = Date.parse(healthEntry.unavailableUntil)
      if (Number.isFinite(unavailableUntil) && unavailableUntil > now().getTime()) {
        attempts.push({
          attemptId,
          provider,
          phase: 'preflight',
          status: 'skipped',
          failure: 'quota_exhausted',
          safeToFallback: true,
          startedAt,
          finishedAt: now().toISOString(),
        })
        lastFailure = 'quota_exhausted'
        continue
      }
      delete health.providers[provider]
      if (options.healthFile) await writeProviderHealth(options.healthFile, health)
    }

    const attemptRequest = continuationRequest(request, attempts)
    const preflight = await adapter.preflight(attemptRequest, execute)
    if (!preflight.ok) {
      const failure = preflight.failure ?? 'runtime_error'
      if (failure === 'quota_exhausted') {
        health.providers[provider] = {
          failure,
          detectedAt: now().toISOString(),
          unavailableUntil: new Date(now().getTime() + quotaCooldownMs).toISOString(),
          resetHint: preflight.detail ? quotaResetHint(preflight.detail) : undefined,
        }
        if (options.healthFile) await writeProviderHealth(options.healthFile, health)
      }
      attempts.push({
        attemptId,
        provider,
        phase: 'preflight',
        status: 'failed',
        failure,
        safeToFallback: true,
        startedAt,
        finishedAt: now().toISOString(),
      })
      lastFailure = failure
      continue
    }

    const finalOutputPath = join(runDir, attemptId + '-final.local.txt')
    const invocation = adapter.buildInvocation(attemptRequest, { finalOutputPath })
    const processResult = await execute(invocation, attemptRequest.timeoutMs ?? 30 * 60_000)
    const failure = detectProcessFailure(processResult)
    if (failure) {
      const possibleSideEffect = adapter.detectPossibleSideEffect(processResult)
      const safeToFallback = mayFallback({
        failure,
        phase: 'running',
        sideEffectMode: request.sideEffectMode,
        possibleSideEffect,
      })
      const refs = await writeAttemptArtifacts(runDir, attemptId, processResult)
      if (failure === 'quota_exhausted') {
        const combined = processResult.stderr + '\n' + processResult.stdout
        const parsedReset = parseQuotaResetAt(combined, now())
        // 復活直後の時計差・反映遅延で再度失敗しないよう2分だけ猶予を置く。
        const unavailableUntil = parsedReset
          ? new Date(parsedReset.getTime() + 2 * 60_000)
          : new Date(now().getTime() + quotaCooldownMs)
        health.providers[provider] = {
          failure,
          detectedAt: now().toISOString(),
          unavailableUntil: unavailableUntil.toISOString(),
          resetHint: quotaResetHint(combined),
        }
        if (options.healthFile) await writeProviderHealth(options.healthFile, health)
      }
      attempts.push({
        attemptId,
        provider,
        phase: 'running',
        status: 'failed',
        failure,
        safeToFallback,
        startedAt,
        finishedAt: now().toISOString(),
        exitCode: processResult.exitCode,
        ...refs,
      })
      lastFailure = failure
      if (safeToFallback) continue
      const blocked: AgentRunResult = {
        runId: request.runId,
        workflowId: request.workflowId,
        status: request.sideEffectMode === 'direct' || request.sideEffectMode === 'reconcile' ? 'needs_resume' : 'failed',
        provider,
        sideEffectState: request.sideEffectMode === 'direct' || request.sideEffectMode === 'reconcile'
          ? 'unknown'
          : request.sideEffectMode === 'workspace' ? 'workspace' : 'none',
        safeToFallback: false,
        failure,
        attempts,
      }
      await writeFile(join(runDir, 'run.local.json'), JSON.stringify(blocked, null, 2), 'utf8')
      return blocked
    }

    const output = await adapter.readOutput(processResult, { finalOutputPath })
    const validationFailure = await validateOutput(output, request.outputSchemaPath)
    const refs = await writeAttemptArtifacts(runDir, attemptId, processResult, output)
    if (validationFailure) {
      const possibleSideEffect = adapter.detectPossibleSideEffect(processResult)
      const safeToFallback = mayFallback({
        failure: validationFailure,
        phase: 'validating',
        sideEffectMode: request.sideEffectMode,
        possibleSideEffect,
      })
      attempts.push({
        attemptId,
        provider,
        phase: 'validating',
        status: 'failed',
        failure: validationFailure,
        safeToFallback,
        startedAt,
        finishedAt: now().toISOString(),
        exitCode: processResult.exitCode,
        ...refs,
      })
      lastFailure = validationFailure
      if (safeToFallback) continue
      const invalid: AgentRunResult = {
        runId: request.runId,
        workflowId: request.workflowId,
        status: request.sideEffectMode === 'direct' || request.sideEffectMode === 'reconcile' ? 'needs_resume' : 'failed',
        provider,
        sideEffectState: request.sideEffectMode === 'direct' || request.sideEffectMode === 'reconcile'
          ? 'unknown'
          : request.sideEffectMode === 'workspace' ? 'workspace' : 'none',
        safeToFallback: false,
        failure: validationFailure,
        attempts,
      }
      await writeFile(join(runDir, 'run.local.json'), JSON.stringify(invalid, null, 2), 'utf8')
      return invalid
    }

    attempts.push({
      attemptId,
      provider,
      phase: 'validating',
      status: 'succeeded',
      safeToFallback: false,
      startedAt,
      finishedAt: now().toISOString(),
      exitCode: processResult.exitCode,
      ...refs,
    })
    if (health.providers[provider]) {
      delete health.providers[provider]
      if (options.healthFile) await writeProviderHealth(options.healthFile, health)
    }
    const succeeded: AgentRunResult = {
      runId: request.runId,
      workflowId: request.workflowId,
      status: 'succeeded',
      provider,
      sideEffectState: request.sideEffectMode === 'direct' || request.sideEffectMode === 'reconcile'
        ? 'committed'
        : request.sideEffectMode === 'workspace' ? 'workspace' : 'none',
      safeToFallback: false,
      output,
      outputRef: refs.outputRef,
      attempts,
    }
    await writeFile(join(runDir, 'run.local.json'), JSON.stringify({ ...succeeded, output: undefined }, null, 2), 'utf8')
    return succeeded
  }

  const failed: AgentRunResult = {
    runId: request.runId,
    workflowId: request.workflowId,
    status: 'failed',
    sideEffectState: request.sideEffectMode === 'reconcile'
      ? 'unknown'
      : request.sideEffectMode === 'workspace' ? 'workspace' : 'none',
    safeToFallback: false,
    failure: lastFailure,
    attempts,
  }
  await writeFile(join(runDir, 'run.local.json'), JSON.stringify(failed, null, 2), 'utf8')
  return failed
}

export function commandPreview(adapter: AgentAdapter, request: AgentRunRequest, finalOutputPath: string): {
  provider: ProviderId
  command: string
  args: string[]
  promptViaStdin: true
} {
  const invocation = adapter.buildInvocation(request, { finalOutputPath })
  return {
    provider: adapter.id,
    command: invocation.command,
    args: invocation.args,
    promptViaStdin: true,
  }
}
