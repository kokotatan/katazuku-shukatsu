import { join, resolve } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  commandPreview,
  createDefaultAdapters,
  executeProcess,
  type AgentRunRequest,
} from '../src/agent-runtime'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..', '..')
const request: AgentRunRequest = {
  runId: 'agent-doctor',
  workflowId: 'agent-doctor',
  prompt: '',
  cwd: repoRoot,
  capabilities: ['workspace.read'],
  risk: 'read-only',
  sideEffectMode: 'none',
}

const adapters = await createDefaultAdapters()
let failed = 0
for (const adapter of adapters) {
  const preview = commandPreview(adapter, request, join(repoRoot, 'logs', 'agent-runs', 'doctor-final.local.txt'))
  let preflight = await adapter.preflight(request, executeProcess)
  let diagnostics: unknown = null
  let sandbox: { ok: boolean; detail: string | null } | null = null
  if (adapter.id === 'codex' && preflight.ok && process.platform === 'win32') {
    // helperなしのcodex.exeだとsandbox内の全shell実行がCreateProcessWithLogonW failed: 2で失敗する
    const marker = 'katazuku-sandbox-ok'
    const probe = await executeProcess({
      command: preview.command,
      args: ['sandbox', '--', 'cmd', '/d', '/c', 'echo ' + marker],
      cwd: repoRoot,
    }, 120_000)
    const combined = probe.stdout + '\n' + probe.stderr
    if (combined.includes(marker)) {
      sandbox = { ok: true, detail: null }
    } else {
      const failure = combined.match(/windows sandbox[^\r\n]*|CreateProcessWithLogonW[^\r\n]*/i)
      sandbox = {
        ok: false,
        detail: (failure?.[0] ?? 'sandbox実行の出力にmarkerがありません')
          + ' (codex-command-runner.exeがcodex.exeと同じ場所にあるか確認)',
      }
      preflight = { ok: false, failure: 'connection_failed' }
    }
  }
  if (adapter.id === 'codex' && preflight.ok) {
    const doctor = await executeProcess({
      command: preview.command,
      args: ['doctor', '--json'],
      cwd: repoRoot,
    }, 30_000)
    try {
      const report = JSON.parse(doctor.stdout) as {
        overallStatus?: string
        checks?: Record<string, { id: string; status: string; summary: string }>
      }
      diagnostics = Object.values(report.checks ?? {})
        .filter((item) => item.status === 'fail')
        .map((item) => ({ id: item.id, summary: item.summary }))
      if (report.overallStatus === 'fail') {
        preflight = { ok: false, failure: 'connection_failed' }
      }
    } catch {
      if (doctor.exitCode !== 0) preflight = { ok: false, failure: 'runtime_error' }
    }
  }
  if (!preflight.ok) failed += 1
  console.log(JSON.stringify({
    provider: adapter.id,
    ready: preflight.ok,
    failure: preflight.failure ?? null,
    command: preview.command,
    capabilities: [...adapter.capabilities].sort(),
    sandbox,
    diagnostics,
    note: adapter.id === 'codex-oss'
      ? 'CLIだけを確認。OllamaまたはLM Studioのmodel endpointはworkflow実行時に確認する'
      : null,
  }))
}

if (failed === adapters.length) process.exitCode = 1
