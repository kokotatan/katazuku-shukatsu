import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  classifyFailure,
  commandPreview,
  createClaudeAdapter,
  createCodexAdapter,
  detectCodexExtraCapabilities,
  detectProcessFailure,
  executeProcess,
  mayFallback,
  parseQuotaResetAt,
  parseProviderOrder,
  resolveProviderCommands,
  runAgent,
  validateJsonSchema,
  type AgentAdapter,
  type AgentRunRequest,
  type ProcessExecutor,
  type ProcessResult,
  type ProviderId,
} from '../src/agent-runtime'

let passed = 0
let failed = 0

async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    passed += 1
    console.log('[OK] ' + name)
  } catch (error) {
    failed += 1
    console.error('[NG] ' + name + ': ' + (error as Error).message)
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function expectThrow(fn: () => unknown, pattern: RegExp): void {
  try {
    fn()
  } catch (error) {
    if (pattern.test((error as Error).message)) return
    throw error
  }
  throw new Error('例外が発生しませんでした')
}

function processResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return {
    exitCode: 0,
    signal: null,
    stdout: '',
    stderr: '',
    timedOut: false,
    durationMs: 1,
    ...overrides,
  }
}

function queuedExecutor(results: ProcessResult[], invocations: { command: string; args: string[]; stdin?: string }[]): ProcessExecutor {
  return async (invocation) => {
    invocations.push({ command: invocation.command, args: invocation.args, stdin: invocation.stdin })
    const next = results.shift()
    if (!next) throw new Error('fake process resultが不足しています')
    return next
  }
}

function fakeAdapter(id: ProviderId, options: {
  preflightFailure?: ReturnType<typeof classifyFailure>
  possibleSideEffect?: boolean
  capabilities?: string[]
} = {}): AgentAdapter {
  return {
    id,
    capabilities: new Set(options.capabilities ?? ['workspace.read', 'workspace.write', 'web.search']),
    strictCapabilities: true,
    async preflight(request) {
      const missing = request.capabilities.find((item) => !this.capabilities.has(item))
      if (missing) return { ok: false, failure: 'capability_missing' }
      return options.preflightFailure ? { ok: false, failure: options.preflightFailure } : { ok: true }
    },
    buildInvocation(request) {
      return { command: id, args: ['run'], stdin: request.prompt, cwd: request.cwd }
    },
    async readOutput(result) {
      return result.stdout
    },
    detectPossibleSideEffect() {
      return options.possibleSideEffect ?? false
    },
  }
}

function request(overrides: Partial<AgentRunRequest> = {}): AgentRunRequest {
  return {
    runId: 'runtime-test',
    workflowId: 'runtime-test',
    prompt: '秘密を含み得るテストプロンプト',
    cwd: process.cwd(),
    capabilities: ['workspace.read'],
    risk: 'read-only',
    sideEffectMode: 'none',
    providerOrder: ['codex', 'claude'],
    timeoutMs: 1_000,
    ...overrides,
  }
}

const workDir = await mkdtemp(join(tmpdir(), 'katazuku-agent-runtime-'))

try {
  await check('provider順を重複なしで解決する', () => {
    const order = parseProviderOrder('claude,codex,claude,codex-oss')
    assert(order.join(',') === 'claude,codex,codex-oss', order.join(','))
  })

  await check('未知のproviderを拒否する', () => {
    expectThrow(() => parseProviderOrder('codex,unknown'), /未知のprovider/)
  })

  await check('provider既定順はClaude優先', () => {
    const order = parseProviderOrder(undefined)
    assert(order.join(',') === 'claude,codex,codex-oss', order.join(','))
  })

  if (process.platform === 'win32') {
    await check('Windowsではsandbox helper付きのcodex実体を優先する', async () => {
      const base = join(workDir, 'codex-resolve')
      const pathDir = join(base, 'path-bin')
      const localAppData = join(base, 'local')
      const bundledDir = join(localAppData, 'OpenAI', 'Codex', 'bin', 'abc123')
      await mkdir(pathDir, { recursive: true })
      await mkdir(bundledDir, { recursive: true })
      await writeFile(join(pathDir, 'codex.exe'), '', 'utf8')
      await writeFile(join(bundledDir, 'codex.exe'), '', 'utf8')
      await writeFile(join(bundledDir, 'codex-command-runner.exe'), '', 'utf8')
      const env = { PATH: pathDir, LOCALAPPDATA: localAppData } as NodeJS.ProcessEnv
      const withoutHelper = await resolveProviderCommands(env)
      assert(withoutHelper.codex === join(bundledDir, 'codex.exe'), withoutHelper.codex)
      await writeFile(join(pathDir, 'codex-command-runner.exe'), '', 'utf8')
      const withHelper = await resolveProviderCommands(env)
      assert(withHelper.codex === join(pathDir, 'codex.exe'), withHelper.codex)
    })
  }

  await check('利用枠切れを共通failureへ分類する', () => {
    const failure = classifyFailure(processResult({ exitCode: 1, stderr: 'Usage limit reached' }))
    assert(failure === 'quota_exhausted', failure)
  })

  await check('Claudeの実際の週制限文言と復活日時を解釈する', () => {
    const message = 'You\'ve hit your weekly limit · resets Jul 26, 9pm (Asia/Tokyo)'
    assert(classifyFailure(processResult({ exitCode: 1, stderr: message })) === 'quota_exhausted', 'weekly limitを認識しません')
    assert(detectProcessFailure(processResult({ exitCode: 0, stdout: message })) === 'quota_exhausted', '終了コード0のlimitを見逃しました')
    assert(detectProcessFailure(processResult({
      exitCode: 0,
      stdout: '=== calendar-sync DONE ===',
      stderr: 'tool error: file not found, recovered and completed',
    })) === undefined, '回復済みtool errorを正常終了後も失敗扱いしました')
    assert(detectProcessFailure(processResult({
      exitCode: 0,
      stdout: 'Gmail MCP が使えないため中止します。DBやシートへの変更は一切ありません。',
    })) === 'capability_missing', '終了コード0のMCP未接続中止を見逃しました')
    assert(detectProcessFailure(processResult({
      exitCode: 0,
      stdout: 'google-workspace MCPが使えないため中止(完了行なし)',
    })) === 'capability_missing', '表記ゆれ(スペースなし)のMCP中止を見逃しました')
    const reset = parseQuotaResetAt(message, new Date('2026-07-24T05:00:00.000Z'))
    assert(reset?.toISOString() === '2026-07-26T12:00:00.000Z', reset?.toISOString() ?? '日時なし')
    const event = JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { rateLimitType: 'seven_day', resetsAt: 1785067200 } })
    assert(classifyFailure(processResult({ exitCode: 1, stdout: event })) === 'quota_exhausted', '構造化limitを認識しません')
    assert(parseQuotaResetAt(event, new Date('2026-07-24T05:00:00.000Z'))?.toISOString() === '2026-07-26T12:00:00.000Z', 'resetsAtを解釈できません')
  })

  await check('週制限の「まだ使える」警告を枠切れ扱いしない', () => {
    // 2026-07-30 実測: 使用率0.82の警告(status=allowed_warning)だけでClaudeを8/2まで締め出し、
    // asa/daily-syncが3日間停止した。allowed系は停止ではないので失敗にしてはいけない。
    const warning = JSON.stringify({
      type: 'rate_limit_event',
      rate_limit_info: { status: 'allowed_warning', resetsAt: 1785672000, rateLimitType: 'seven_day', utilization: 0.82 },
    })
    assert(
      detectProcessFailure(processResult({ exitCode: 0, stdout: '=== asa 完了 ===\n' + warning })) === undefined,
      '使用率警告だけで正常終了を失敗扱いしました',
    )
    assert(
      classifyFailure(processResult({ exitCode: 1, stdout: warning })) !== 'quota_exhausted',
      '使用率警告を枠切れに分類しました',
    )
    // 実際に止められた場合は従来どおり枠切れとして扱う
    const blocked = JSON.stringify({
      type: 'rate_limit_event',
      rate_limit_info: { status: 'blocked', resetsAt: 1785672000, rateLimitType: 'seven_day' },
    })
    assert(
      detectProcessFailure(processResult({ exitCode: 0, stdout: blocked })) === 'quota_exhausted',
      '実際の停止を見逃しました',
    )
    // 警告の後に停止が来る混在ログでも、停止を優先して検知する
    assert(
      classifyFailure(processResult({ exitCode: 1, stdout: warning + '\n' + blocked })) === 'quota_exhausted',
      '警告と停止が混在するログで停止を見逃しました',
    )
  })

  await check('認証切れ・接続失敗・spawn失敗を分類する', async () => {
    assert(classifyFailure(processResult({ exitCode: 1, stderr: 'Login required' })) === 'auth_unavailable', 'auth')
    assert(classifyFailure(processResult({ exitCode: 1, stderr: 'Unable to connect to API' })) === 'connection_failed', 'connection')
    assert(classifyFailure(processResult({
      exitCode: 1,
      stderr: 'failed to initialize in-process app-server client: access denied',
    })) === 'connection_failed', 'startup')
    const spawnFailure = await executeProcess({
      command: process.execPath,
      args: ['--version'],
      cwd: join(workDir, '存在しないcwd'),
    }, 1_000)
    assert(Boolean(spawnFailure.errorCode), 'spawn失敗がProcessResultへ変換されません')
  })

  await check('CLIの引数エラーは起動前失敗として安全に分類する', () => {
    const stderr = "error: unexpected argument '--search' found\n\nUsage: codex exec [OPTIONS]\nFor more information, try '--help'."
    assert(classifyFailure(processResult({ exitCode: 2, stderr })) === 'command_missing', 'usage errorがcommand_missingになりません')
    // 実行時の "not found" 等をcommand_missingへ誤爆させない
    assert(classifyFailure(processResult({ exitCode: 1, stderr: 'Error: file not found' })) === 'runtime_error', 'runtime errorを誤分類しました')
  })

  await check('web searchのconfig overrideはenvで差し替えられる', () => {
    const adapter = createCodexAdapter({ command: 'codex', webSearchArgs: ['--enable', 'web_search'] })
    const preview = commandPreview(adapter, request({ capabilities: ['workspace.read', 'web.search'] }), join(workDir, 'ws.txt'))
    assert(preview.args.includes('web_search') && !preview.args.includes('tools.web_search=true'), 'webSearchArgsの差し替えが効いていません')
  })

  await check('起動時の引数エラーは副作用前として次providerへ切り替える', async () => {
    const calls: { command: string; args: string[]; stdin?: string }[] = []
    const execute = queuedExecutor([
      processResult({ exitCode: 2, stderr: "error: unexpected argument '--search' found" }),
      processResult({ stdout: 'Claudeで完了' }),
    ], calls)
    const result = await runAgent(request({ runId: 'argerror-fallback', risk: 'db-write', sideEffectMode: 'direct' }), {
      adapters: [fakeAdapter('codex'), fakeAdapter('claude')],
      artifactDir: workDir,
      execute,
    })
    assert(result.status === 'succeeded' && result.provider === 'claude', JSON.stringify(result))
    assert(result.attempts[0].failure === 'command_missing', '起動前失敗として記録されていません')
  })

  await check('副作用なしの失敗だけフォールバックできる', () => {
    assert(mayFallback({
      failure: 'quota_exhausted',
      phase: 'running',
      sideEffectMode: 'direct',
      possibleSideEffect: false,
    }), '開始前のquotaは切替可能')
    assert(!mayFallback({
      failure: 'quota_exhausted',
      phase: 'running',
      sideEffectMode: 'direct',
      possibleSideEffect: true,
    }), '副作用後は切替禁止')
    assert(mayFallback({
      failure: 'quota_exhausted',
      phase: 'running',
      sideEffectMode: 'reconcile',
      possibleSideEffect: true,
    }), '再照合モードは副作用後も切替可能')
  })

  await check('Codexは非対話・stdin・安全なsandboxで起動する', () => {
    const adapter = createCodexAdapter({ command: 'codex', voiceboxMcpUrl: 'http://127.0.0.1:17493/mcp' })
    const preview = commandPreview(adapter, request({ risk: 'db-write', capabilities: ['workspace.read', 'web.search', 'voice.transcribe'] }), join(workDir, 'final.txt'))
    assert(preview.args[0] === 'exec', 'codex execではありません')
    assert(preview.args.includes('--json') && preview.args.includes('--output-last-message'), '自動化用出力がありません')
    assert(preview.args.includes('workspace-write'), 'workspace-writeではありません')
    assert(preview.args.includes('tools.web_search=true'), 'web searchがconfig overrideで有効化されていません')
    assert(preview.args.some((arg) => arg.includes('mcp_servers.voicebox.url=')), 'Voicebox MCP設定がありません')
    assert(!preview.args.includes('--search'), '現行codexが解釈できない--searchを渡しています')
    assert(preview.args.at(-1) === '-', 'promptをstdinから読んでいません')
    assert(!preview.args.some((arg) => /danger|yolo/.test(arg)), '危険なflagがあります')
  })

  await check('ローカルOSS adapterはCodexのlocal provider境界を使う', () => {
    const adapter = createCodexAdapter({ command: 'codex', localProvider: 'lmstudio' }, 'codex-oss')
    const preview = commandPreview(adapter, request(), join(workDir, 'oss-final.txt'))
    assert(preview.args.includes('--oss'), '--ossがありません')
    assert(preview.args.includes('lmstudio'), 'local providerがありません')
  })

  await check('Claudeはstream-jsonで副作用と最終出力を分離する', async () => {
    const adapter = createClaudeAdapter({ command: 'claude' })
    const req = request({ capabilities: ['workspace.read', 'web.search'] })
    const preview = commandPreview(adapter, req, join(workDir, 'unused.txt'))
    assert(preview.args.includes('-p'), 'headless modeではありません')
    assert(preview.args.includes('stream-json') && preview.args.includes('--verbose'), '構造化event出力ではありません')
    assert(preview.args.includes('WebSearch'), 'capabilityがallowedToolsへ変換されていません')
    assert(!preview.args.includes(req.prompt), 'promptが引数へ漏れています')

    const limited = processResult({
      exitCode: 1,
      stdout: [
        JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'seven_day' } }),
        JSON.stringify({ type: 'result', is_error: true, result: 'weekly limit' }),
      ].join('\n'),
    })
    assert(!adapter.detectPossibleSideEffect(limited), 'tool実行前のlimitを副作用ありと誤判定しました')

    const touched = processResult({
      exitCode: 1,
      stdout: JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit' }] } }),
    })
    assert(adapter.detectPossibleSideEffect(touched), 'tool実行済みを見逃しました')

    const completed = processResult({
      stdout: [
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '途中' }] } }),
        JSON.stringify({ type: 'result', result: '最終結果' }),
      ].join('\n'),
    })
    assert(await adapter.readOutput(completed, { finalOutputPath: join(workDir, 'unused.txt') }) === '最終結果', '最終resultを抽出できません')
  })

  await check('共通JSON Schemaで未知項目を拒否する', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['status'],
      properties: { status: { enum: ['ok'] } },
    }
    assert(validateJsonSchema({ status: 'ok' }, schema).length === 0, '正常値が拒否されました')
    assert(validateJsonSchema({ status: 'ok', secret: true }, schema).length === 1, '未知項目が通りました')
  })

  await check('preflight失敗時は次providerへ切り替える', async () => {
    const calls: { command: string; args: string[]; stdin?: string }[] = []
    const execute = queuedExecutor([processResult({ stdout: '完了' })], calls)
    const result = await runAgent(request({ runId: 'preflight-fallback' }), {
      adapters: [
        fakeAdapter('codex', { preflightFailure: 'command_missing' }),
        fakeAdapter('claude'),
      ],
      artifactDir: workDir,
      execute,
    })
    assert(result.status === 'succeeded' && result.provider === 'claude', JSON.stringify(result))
    assert(result.attempts[0].phase === 'preflight' && result.attempts[0].safeToFallback, 'preflight記録が不正です')
  })

  await check('利用枠切れが副作用前ならCodexからClaudeへ切り替える', async () => {
    const calls: { command: string; args: string[]; stdin?: string }[] = []
    const execute = queuedExecutor([
      processResult({ exitCode: 1, stderr: 'quota exceeded' }),
      processResult({ stdout: 'Claudeで完了' }),
    ], calls)
    const result = await runAgent(request({ runId: 'quota-fallback', risk: 'db-write', sideEffectMode: 'direct' }), {
      adapters: [fakeAdapter('codex'), fakeAdapter('claude')],
      artifactDir: workDir,
      execute,
    })
    assert(result.status === 'succeeded' && result.provider === 'claude', JSON.stringify(result))
    assert(calls.length === 2, '次providerが実行されていません')
  })

  await check('Claude利用枠切れからCodexへ切り替えられる', async () => {
    const calls: { command: string; args: string[]; stdin?: string }[] = []
    const execute = queuedExecutor([
      processResult({ exitCode: 1, stderr: 'usage limit reached' }),
      processResult({ stdout: 'Codexで完了' }),
    ], calls)
    const result = await runAgent(request({
      runId: 'claude-to-codex',
      risk: 'db-write',
      sideEffectMode: 'reconcile',
      providerOrder: ['claude', 'codex'],
    }), {
      adapters: [fakeAdapter('claude', { possibleSideEffect: true }), fakeAdapter('codex')],
      artifactDir: workDir,
      execute,
    })
    assert(result.status === 'succeeded' && result.provider === 'codex', JSON.stringify(result))
    assert(result.attempts[0].failure === 'quota_exhausted', 'Claudeの利用枠切れが記録されていません')
    assert(calls[1].stdin?.includes('Gmail、Calendar、Drive、DB'), '外部状態の再照合指示が渡っていません')
  })

  await check('週制限を記録し、復活まではClaudeを飛ばす', async () => {
    const healthFile = join(workDir, 'provider-health-test.local.json')
    const limitedAt = new Date('2026-07-24T05:00:00.000Z')
    const message = 'You\'ve hit your weekly limit · resets Jul 26, 9pm (Asia/Tokyo)'
    const firstCalls: { command: string; args: string[]; stdin?: string }[] = []
    const first = await runAgent(request({
      runId: 'health-first',
      risk: 'db-write',
      sideEffectMode: 'workspace',
      providerOrder: ['claude', 'codex'],
    }), {
      adapters: [fakeAdapter('claude', { possibleSideEffect: true }), fakeAdapter('codex')],
      artifactDir: workDir,
      healthFile,
      now: () => limitedAt,
      execute: queuedExecutor([
        processResult({ exitCode: 1, stderr: message }),
        processResult({ stdout: 'Codexで続行完了' }),
      ], firstCalls),
    })
    assert(first.status === 'succeeded' && first.provider === 'codex', JSON.stringify(first))
    assert(firstCalls[1].stdin?.includes('前のproviderが同じ作業ツリー'), 'Codexへ継続指示が渡っていません')
    const health = JSON.parse(await readFile(healthFile, 'utf8')) as {
      providers: { claude?: { unavailableUntil?: string; resetHint?: string } }
    }
    assert(health.providers.claude?.unavailableUntil === '2026-07-26T12:02:00.000Z', JSON.stringify(health))
    assert(health.providers.claude?.resetHint?.includes('Jul 26'), 'reset hintがありません')

    const secondCalls: { command: string; args: string[]; stdin?: string }[] = []
    const second = await runAgent(request({
      runId: 'health-second',
      providerOrder: ['claude', 'codex'],
    }), {
      adapters: [fakeAdapter('claude'), fakeAdapter('codex')],
      artifactDir: workDir,
      healthFile,
      now: () => new Date('2026-07-25T00:00:00.000Z'),
      execute: queuedExecutor([processResult({ stdout: 'Codexで完了' })], secondCalls),
    })
    assert(second.provider === 'codex' && secondCalls.length === 1, JSON.stringify(second))
    assert(second.attempts[0].status === 'skipped' && second.attempts[0].failure === 'quota_exhausted', 'Claudeがskipされません')

    const thirdCalls: { command: string; args: string[]; stdin?: string }[] = []
    const third = await runAgent(request({
      runId: 'health-third',
      providerOrder: ['claude', 'codex'],
    }), {
      adapters: [fakeAdapter('claude'), fakeAdapter('codex')],
      artifactDir: workDir,
      healthFile,
      now: () => new Date('2026-07-26T12:03:00.000Z'),
      execute: queuedExecutor([processResult({ stdout: 'Claude復活' })], thirdCalls),
    })
    assert(third.provider === 'claude' && thirdCalls.length === 1, JSON.stringify(third))
    const recoveredHealth = JSON.parse(await readFile(healthFile, 'utf8')) as { providers: Record<string, unknown> }
    assert(!recoveredHealth.providers.claude, '復活後もClaudeがcooldownのままです')
  })

  await check('副作用の可能性があれば自動切替せずneeds_resumeにする', async () => {
    const calls: { command: string; args: string[]; stdin?: string }[] = []
    const execute = queuedExecutor([processResult({ exitCode: 1, stderr: 'quota exceeded', stdout: 'tool started' })], calls)
    const result = await runAgent(request({
      runId: 'partial-side-effect',
      risk: 'external-commit',
      sideEffectMode: 'direct',
    }), {
      adapters: [fakeAdapter('codex', { possibleSideEffect: true }), fakeAdapter('claude')],
      artifactDir: workDir,
      execute,
    })
    assert(result.status === 'needs_resume', JSON.stringify(result))
    assert(result.sideEffectState === 'unknown', '副作用状態がunknownではありません')
    assert(calls.length === 1, '次providerを実行してしまいました')
  })

  await check('副作用のない構造化出力はschema不一致でも次providerへ進める', async () => {
    const schemaPath = join(workDir, 'result.schema.json')
    await writeFile(schemaPath, JSON.stringify({
      type: 'object',
      additionalProperties: false,
      required: ['status'],
      properties: { status: { const: 'ok' } },
    }), 'utf8')
    const calls: { command: string; args: string[]; stdin?: string }[] = []
    const execute = queuedExecutor([
      processResult({ stdout: '{"status":"ng"}' }),
      processResult({ stdout: '{"status":"ok"}' }),
    ], calls)
    const result = await runAgent(request({
      runId: 'schema-fallback',
      outputSchemaPath: schemaPath,
      sideEffectMode: 'none',
    }), {
      adapters: [fakeAdapter('codex'), fakeAdapter('claude')],
      artifactDir: workDir,
      execute,
    })
    assert(result.status === 'succeeded' && result.provider === 'claude', JSON.stringify(result))
    assert(result.attempts[0].failure === 'invalid_output', 'schema失敗が記録されていません')
  })

  await check('capability不足は実行前に除外する', async () => {
    const configRoot = join(workDir, 'codex-capability')
    const nested = join(configRoot, 'sync')
    await mkdir(join(configRoot, '.codex'), { recursive: true })
    await mkdir(nested, { recursive: true })
    await writeFile(
      join(configRoot, '.codex', 'config.toml'),
      '[mcp_servers.google-workspace]\ncommand = \'node\'\n[mcp_servers.voicebox]\nurl = \'http://127.0.0.1:17493/mcp\'\n',
      'utf8',
    )
    const detected = await detectCodexExtraCapabilities(nested)
    assert(
      detected.includes('gmail.read') && detected.includes('gmail.send')
        && detected.includes('calendar.write') && detected.includes('sheets.write')
        && detected.includes('voice.transcribe'),
      '設定済みMCP capabilityを検出できません',
    )

    const calls: { command: string; args: string[]; stdin?: string }[] = []
    const execute = queuedExecutor([processResult({ stdout: '完了' })], calls)
    const result = await runAgent(request({
      runId: 'capability-fallback',
      capabilities: ['browser.interact'],
    }), {
      adapters: [
        fakeAdapter('codex', { capabilities: ['workspace.read'] }),
        fakeAdapter('claude', { capabilities: ['browser.interact'] }),
      ],
      artifactDir: workDir,
      execute,
    })
    assert(result.status === 'succeeded' && result.provider === 'claude', JSON.stringify(result))
  })

  await check('promptはprovider引数やrun台帳へ保存しない', async () => {
    const calls: { command: string; args: string[]; stdin?: string }[] = []
    const req = request({ runId: 'prompt-boundary', prompt: 'TOP-SECRET-PROMPT' })
    const result = await runAgent(req, {
      adapters: [fakeAdapter('codex')],
      artifactDir: workDir,
      execute: queuedExecutor([processResult({ stdout: '正常終了' })], calls),
    })
    assert(result.status === 'succeeded', JSON.stringify(result))
    assert(calls[0].stdin === req.prompt && !calls[0].args.includes(req.prompt), 'promptがstdin境界にありません')
    const ledger = await readFile(join(workDir, 'prompt-boundary', 'run.local.json'), 'utf8')
    assert(!ledger.includes(req.prompt), 'run台帳へpromptが入りました')
  })

  // 注: 個人リポの PowerShell ランナーが provider を直呼びしないことを検証する
  // リポ衛生テストは、公開版では対象スクリプトを同梱しないため省いている。
} finally {
  await rm(workDir, { recursive: true, force: true })
}

console.log('agent runtimeテスト: ' + passed + '件成功 / ' + failed + '件失敗')
if (failed) process.exit(1)
