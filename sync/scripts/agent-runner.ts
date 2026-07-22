import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PROVIDER_IDS,
  commandPreview,
  createDefaultAdapters,
  parseProviderOrder,
  runAgent,
  type AgentRisk,
  type AgentRunRequest,
  type ProviderId,
  type SideEffectMode,
} from '../src/agent-runtime'

interface CliOptions {
  workflow?: string
  runId?: string
  promptFile?: string
  cwd?: string
  risk: AgentRisk
  sideEffectMode?: SideEffectMode
  capabilities: string[]
  provider?: 'auto' | ProviderId
  providerOrder?: string
  outputSchema?: string
  outputFile?: string
  artifactDir?: string
  timeoutMs?: number
  dryRun: boolean
}

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..', '..')

function takeValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(flag + ' の値がありません')
  return value
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    risk: 'read-only',
    capabilities: [],
    provider: 'auto',
    dryRun: false,
  }
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]
    if (flag === '--dry-run') {
      options.dryRun = true
      continue
    }
    const value = takeValue(args, index, flag)
    index += 1
    if (flag === '--workflow') options.workflow = value
    else if (flag === '--run-id') options.runId = value
    else if (flag === '--prompt-file') options.promptFile = value
    else if (flag === '--cwd') options.cwd = value
    else if (flag === '--risk') options.risk = value as AgentRisk
    else if (flag === '--side-effect-mode') options.sideEffectMode = value as SideEffectMode
    else if (flag === '--capability') options.capabilities.push(...value.split(',').map((item) => item.trim()).filter(Boolean))
    else if (flag === '--provider') options.provider = value as 'auto' | ProviderId
    else if (flag === '--provider-order') options.providerOrder = value
    else if (flag === '--output-schema') options.outputSchema = value
    else if (flag === '--output-file') options.outputFile = value
    else if (flag === '--artifact-dir') options.artifactDir = value
    else if (flag === '--timeout-ms') options.timeoutMs = Number(value)
    else throw new Error('未知の引数です: ' + flag)
  }
  return options
}

function requireChoice<T extends string>(value: string, choices: readonly T[], label: string): asserts value is T {
  if (!choices.includes(value as T)) throw new Error(label + ' が不正です: ' + value)
}

function absoluteFrom(base: string, value?: string): string | undefined {
  if (!value) return undefined
  return isAbsolute(value) ? value : resolve(base, value)
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  if (!options.workflow) throw new Error('--workflow は必須です')
  if (!options.runId) throw new Error('--run-id は必須です')
  if (!options.promptFile) throw new Error('--prompt-file は必須です')
  requireChoice(options.risk, ['read-only', 'db-write', 'external-draft', 'external-commit'] as const, '--risk')
  if (options.sideEffectMode) requireChoice(options.sideEffectMode, ['none', 'direct'] as const, '--side-effect-mode')
  if (options.provider && options.provider !== 'auto') requireChoice(options.provider, PROVIDER_IDS, '--provider')
  if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) {
    throw new Error('--timeout-ms は正の数にしてください')
  }

  const cwd = absoluteFrom(repoRoot, options.cwd) ?? repoRoot
  const promptFile = absoluteFrom(cwd, options.promptFile) as string
  const prompt = await readFile(promptFile, 'utf8')
  const providerOrder = options.provider && options.provider !== 'auto'
    ? [options.provider]
    : parseProviderOrder(options.providerOrder ?? process.env.KATAZUKU_AGENT_ORDER)
  const request: AgentRunRequest = {
    runId: options.runId,
    workflowId: options.workflow,
    prompt,
    cwd,
    capabilities: [...new Set(options.capabilities.length ? options.capabilities : ['workspace.read'])],
    risk: options.risk,
    sideEffectMode: options.sideEffectMode ?? (options.risk === 'read-only' ? 'none' : 'direct'),
    outputSchemaPath: absoluteFrom(cwd, options.outputSchema),
    providerOrder,
    timeoutMs: options.timeoutMs,
  }
  const adapters = await createDefaultAdapters()
  const artifactDir = absoluteFrom(repoRoot, options.artifactDir) ?? join(repoRoot, 'logs', 'agent-runs')

  if (options.dryRun) {
    const byId = new Map(adapters.map((adapter) => [adapter.id, adapter]))
    const preview = providerOrder
      .map((provider) => byId.get(provider))
      .filter((adapter) => adapter !== undefined)
      .map((adapter) => commandPreview(adapter, request, join(artifactDir, 'dry-run-final.local.txt')))
    console.log(JSON.stringify({ runId: request.runId, workflowId: request.workflowId, preview }, null, 2))
    return
  }

  const result = await runAgent(request, { adapters, artifactDir })
  if (result.status === 'succeeded') {
    if (options.outputFile) {
      const outputFile = absoluteFrom(cwd, options.outputFile) as string
      await mkdir(dirname(outputFile), { recursive: true })
      await writeFile(outputFile, result.output ?? '', 'utf8')
    }
    if (result.output) process.stdout.write(result.output.endsWith('\n') ? result.output : result.output + '\n')
    console.error('[agent-runner] 完了: ' + result.workflowId + ' / provider=' + result.provider)
    return
  }

  const summary = {
    runId: result.runId,
    workflowId: result.workflowId,
    status: result.status,
    provider: result.provider,
    failure: result.failure,
    sideEffectState: result.sideEffectState,
    attempts: result.attempts.map((attempt) => ({
      provider: attempt.provider,
      phase: attempt.phase,
      status: attempt.status,
      failure: attempt.failure,
      safeToFallback: attempt.safeToFallback,
    })),
  }
  console.error('[agent-runner] 中断: ' + JSON.stringify(summary))
  process.exitCode = result.status === 'needs_resume' ? 3 : 1
}

main().catch((error) => {
  console.error('[agent-runner] 起動失敗: ' + (error as Error).message)
  process.exitCode = 1
})

