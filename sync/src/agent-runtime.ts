import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { delimiter, dirname, join, resolve } from 'node:path'

export const PROVIDER_IDS = ['codex', 'claude', 'codex-oss'] as const
export type ProviderId = (typeof PROVIDER_IDS)[number]
export type AgentRisk = 'read-only' | 'db-write' | 'external-draft' | 'external-commit'
export type SideEffectMode = 'none' | 'direct'
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
  sideEffectState: 'none' | 'committed' | 'unknown'
  safeToFallback: boolean
  output?: string
  outputRef?: string
  failure?: FailureCode
  attempts: AgentAttempt[]
}

export interface RunAgentOptions {
  adapters: AgentAdapter[]
  artifactDir: string
  execute?: ProcessExecutor
  now?: () => Date
}

const BASE_CAPABILITIES = ['workspace.read', 'workspace.write', 'shell']
const CLAUDE_EXTRA_CAPABILITIES = [
  'web.search',
  'gmail.read',
  'gmail.draft',
  'gmail.labels',
  'calendar.read',
  'calendar.write',
  'browser.interact',
  'voice.transcribe',
]

const CLAUDE_TOOLS: Record<string, string[]> = {
  'workspace.read': ['Read', 'Glob', 'Grep'],
  'workspace.write': ['Write', 'Edit'],
  shell: ['PowerShell'],
  'web.search': ['WebSearch', 'WebFetch'],
  'gmail.read': ['mcp__claude_ai_Gmail__*', 'mcp__google-workspace__*gmail*'],
  'gmail.draft': ['mcp__claude_ai_Gmail__*', 'mcp__google-workspace__*gmail*'],
  'gmail.labels': ['mcp__claude_ai_Gmail__*', 'mcp__google-workspace__*gmail*'],
  'calendar.read': ['mcp__claude_ai_Google_Calendar__*', 'mcp__google-workspace__*calendar*'],
  'calendar.write': ['mcp__claude_ai_Google_Calendar__*', 'mcp__google-workspace__*calendar*'],
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

export function classifyFailure(result: ProcessResult): FailureCode {
  if (result.errorCode === 'ENOENT') return 'command_missing'
  if (result.timedOut) return 'timeout'
  const text = (result.stderr + '\n' + result.stdout).toLowerCase()
  // CLIの引数解釈に失敗した(clap等の usage エラー)。invocationが現行CLIの形と合っていないだけで、
  // モデル・ツールは一切動いておらず副作用は起きえない。command_missing相当の安全な起動前失敗として扱う。
  if (/unexpected argument|unrecognized (option|argument|subcommand)|invalid value for|for more information, try '--help'/.test(text)) {
    return 'command_missing'
  }
  if (/usage limit|quota( has been)? exceeded|credit balance|out of extra usage|maximum.*usage/.test(text)) {
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
  return !params.possibleSideEffect && SAFE_START_FAILURES.has(params.failure)
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
    const child = spawn(command, args, {
      cwd: invocation.cwd,
      env: { ...process.env, ...invocation.env },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const finish = (partial: Partial<ProcessResult>) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
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
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)
    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', (error: NodeJS.ErrnoException) => finish({ errorCode: error.code }))
    child.on('close', (exitCode, signal) => finish({ exitCode, signal }))
    // spawn失敗(ENOENT)時、stdinへの書き込みがEPIPE/ENOENTを別途投げ得る。
    // プロセスの'error'とは別ストリームなので、no-opリスナーで未処理例外化を防ぐ(finishはchild.on('error')が担う)。
    child.stdin.on('error', () => {})
    if (invocation.stdin !== undefined) child.stdin.end(invocation.stdin)
    else child.stdin.end()
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
  return result.stdout.trim().length > 0
}

function capabilitySet(base: string[], extra?: string): Set<string> {
  return new Set([...base, ...(extra ?? '').split(',').map((value) => value.trim()).filter(Boolean)])
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
  const capabilities = capabilitySet([...BASE_CAPABILITIES, 'web.search'], options.extraCapabilities)
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
      const tools = unique(request.capabilities.flatMap((capability) => CLAUDE_TOOLS[capability] ?? []))
      const args = ['-p']
      if (tools.length) args.push('--allowedTools', ...tools)
      if (options.model) args.push('--model', options.model)
      return { command: options.command, args, stdin: request.prompt, cwd: request.cwd }
    },
    async readOutput(result) {
      return result.stdout
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

export async function createDefaultAdapters(env: NodeJS.ProcessEnv = process.env): Promise<AgentAdapter[]> {
  const commands = await resolveProviderCommands(env)
  return [
    createCodexAdapter({
      command: commands.codex,
      profile: env.KATAZUKU_CODEX_PROFILE,
      model: env.KATAZUKU_CODEX_MODEL,
      extraCapabilities: env.KATAZUKU_CODEX_CAPABILITIES,
      webSearchArgs: parseWebSearchArgs(env.KATAZUKU_CODEX_WEB_SEARCH),
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
  const runDir = join(options.artifactDir, safeSegment(request.runId))
  await mkdir(runDir, { recursive: true })
  const attempts: AgentAttempt[] = []
  let lastFailure: FailureCode = 'runtime_error'

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

    const preflight = await adapter.preflight(request, execute)
    if (!preflight.ok) {
      const failure = preflight.failure ?? 'runtime_error'
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
    const invocation = adapter.buildInvocation(request, { finalOutputPath })
    const processResult = await execute(invocation, request.timeoutMs ?? 30 * 60_000)
    const failure = processResult.exitCode === 0 ? undefined : classifyFailure(processResult)
    if (failure) {
      const possibleSideEffect = adapter.detectPossibleSideEffect(processResult)
      const safeToFallback = mayFallback({
        failure,
        phase: 'running',
        sideEffectMode: request.sideEffectMode,
        possibleSideEffect,
      })
      const refs = await writeAttemptArtifacts(runDir, attemptId, processResult)
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
        status: request.sideEffectMode === 'direct' ? 'needs_resume' : 'failed',
        provider,
        sideEffectState: request.sideEffectMode === 'direct' ? 'unknown' : 'none',
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
        status: request.sideEffectMode === 'direct' ? 'needs_resume' : 'failed',
        provider,
        sideEffectState: request.sideEffectMode === 'direct' ? 'unknown' : 'none',
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
    const succeeded: AgentRunResult = {
      runId: request.runId,
      workflowId: request.workflowId,
      status: 'succeeded',
      provider,
      sideEffectState: request.sideEffectMode === 'direct' ? 'committed' : 'none',
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
    sideEffectState: 'none',
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
