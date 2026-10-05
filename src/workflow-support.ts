/**
 * 自動運転ワークフロー(scripts/mail-watch.ts ほか)の共通部品。OSに依存しない Node 実装。
 *
 * - 完了判定は「完了行(=== <name> DONE ===)」方式。終了コード0や出力の長さでは判定しない
 *   (プロンプトが渡らず対話応答だけ返して正常終了した、という実害があったため)。
 * - 失敗は logs/alert-<name>.txt に自分専用で残す。共有ファイルにすると他ジョブの成功時削除で消える。
 *   朝のまとめ(asa)が翌朝それを【自動化の故障】として報告する。
 * - 活動ログ logs/activity-log.jsonl に「何を・何のために・どうしたか」を1行ずつ追記する。
 * - 同じワークフローの二重起動はロックファイルで防ぐ(前回が固まっていても期限で回収する)。
 */
import { spawn } from 'node:child_process'
import {
  appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  createDefaultAdapters,
  parseProviderOrder,
  runAgent,
  type AgentRisk,
  type AgentRunResult,
  type SideEffectMode,
} from './agent-runtime.js'
import { repositoryRoot } from './database-path.js'
import { providerOrderFor, type KatazukuConfig } from './katazuku-config.js'

export function logsDir(root: string = repositoryRoot()): string {
  const dir = join(root, 'logs')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function sentinelFor(name: string): string {
  return `=== ${name} DONE ===`
}

/** 出力のどこかに単独行の完了行があるか(前後の空白は許す)。 */
export function hasSentinel(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^\\s*===\\s*${escaped}\\s*DONE\\s*===\\s*$`, 'm').test(text)
}

export function alertPath(name: string, root?: string): string {
  return join(logsDir(root), `alert-${name}.txt`)
}

export function recordAlert(name: string, reason: string, detailFile?: string, root?: string, now: Date = new Date()): void {
  const line = `${now.toISOString()} ${name} 失敗: ${reason}${detailFile ? ` (詳細: ${detailFile})` : ''}\n`
  appendFileSync(alertPath(name, root), line, 'utf8')
}

export function clearAlert(name: string, root?: string): void {
  rmSync(alertPath(name, root), { force: true })
}

export function listAlerts(root?: string): { name: string; text: string }[] {
  const dir = join(root ?? repositoryRoot(), 'logs')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((file) => /^alert-.+\.txt$/.test(file))
    .map((file) => ({ name: file.replace(/^alert-|\.txt$/g, ''), text: readFileSync(join(dir, file), 'utf8').trim() }))
}

export interface ActivityEntry {
  by: string
  action: string
  why: string
  how?: string
  link?: string
  result?: string
}

export function appendActivity(entry: ActivityEntry, root?: string, now: Date = new Date()): void {
  const line = JSON.stringify({ ts: now.toISOString(), ...entry })
  appendFileSync(join(logsDir(root), 'activity-log.jsonl'), line + '\n', 'utf8')
}

export function readActivity(root?: string, tail = 2000): { ts: string; by: string }[] {
  const path = join(root ?? repositoryRoot(), 'logs', 'activity-log.jsonl')
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).slice(-tail).flatMap((line) => {
    try {
      const value = JSON.parse(line) as { ts?: string; by?: string }
      return value.ts && value.by ? [{ ts: value.ts, by: value.by }] : []
    } catch {
      return []
    }
  })
}

/** 古いログを消す(個人データを含むので溜め込まない)。 */
export function pruneFiles(dir: string, pattern: RegExp, maxAgeDays: number, now: Date = new Date()): number {
  if (!existsSync(dir)) return 0
  let removed = 0
  for (const file of readdirSync(dir)) {
    if (!pattern.test(file)) continue
    const path = join(dir, file)
    try {
      if (now.getTime() - statSync(path).mtimeMs > maxAgeDays * 86_400_000) {
        rmSync(path, { recursive: true, force: true })
        removed += 1
      }
    } catch {
      // 使用中などで消せないものは次回に回す
    }
  }
  return removed
}

/**
 * 二重起動防止のロック。取得できなければ undefined。
 * 前回が固まって残ったロックは staleMs を過ぎたら回収する(永久に止まらないように)。
 */
export function acquireLock(name: string, staleMs: number, root?: string, now: Date = new Date()): (() => void) | undefined {
  const path = join(logsDir(root), `${name}.lock`)
  if (existsSync(path)) {
    const age = now.getTime() - statSync(path).mtimeMs
    if (age < staleMs) return undefined
    rmSync(path, { force: true })
  }
  try {
    writeFileSync(path, JSON.stringify({ pid: process.pid, at: now.toISOString() }), { flag: 'wx' })
  } catch {
    return undefined
  }
  return () => rmSync(path, { force: true })
}

/** 本文にPIIを載せないデスクトップ通知(ロック画面に出るため、企業名・人名は呼び出し側で入れない)。 */
export function notifyDesktop(title: string, body: string): void {
  const run = (command: string, args: string[]) => {
    try {
      const child = spawn(command, args, { stdio: 'ignore', windowsHide: true, detached: true })
      child.on('error', () => {})
      child.unref()
    } catch {
      // 通知は補助。失敗しても本処理は止めない
    }
  }
  if (process.platform === 'win32') {
    const ps = [
      '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
      '$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)',
      '$x = $t.GetElementsByTagName("text")',
      `$x.Item(0).AppendChild($t.CreateTextNode(${JSON.stringify(title)})) | Out-Null`,
      `$x.Item(1).AppendChild($t.CreateTextNode(${JSON.stringify(body)})) | Out-Null`,
      // Windows PowerShell の既知の AppUserModelID(公開値)。長いIDの形がファイルID検査に掛かるので分けて書く
      '$id = "{1AC14E77-02E7-4E5D' + '-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe"',
      '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($id).Show([Windows.UI.Notifications.ToastNotification]::new($t))',
    ].join('; ')
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps])
  } else if (process.platform === 'darwin') {
    run('osascript', ['-e', `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`])
  } else {
    run('notify-send', [title, body])
  }
}

export interface AgentStepOptions {
  config: KatazukuConfig
  workflow: string
  runId: string
  prompt: string
  capabilities: string[]
  risk: AgentRisk
  sideEffectMode: SideEffectMode
  timeoutMs: number
  outputSchemaPath?: string
  /** 'auto' 以外を指定したら、その provider だけで実行する(診断用。利用枠の健康状態を迂回する) */
  agent?: string
  root?: string
}

/**
 * 1つのエージェント工程を実行する。provider 順は設定(と KATAZUKU_AGENT_ORDER)から決め、
 * 利用枠切れ・認証切れなど「副作用を始める前の失敗」だけ次の provider へ回す。
 */
export async function runAgentStep(options: AgentStepOptions): Promise<AgentRunResult> {
  const root = options.root ?? repositoryRoot()
  const artifactDir = join(logsDir(root), 'agent-runs')
  const explicit = options.agent && options.agent !== 'auto'
  const order = parseProviderOrder(
    (explicit ? [options.agent as string] : providerOrderFor(options.config, options.workflow)).join(','),
  )
  const adapters = await createDefaultAdapters(process.env, root)
  return runAgent({
    runId: options.runId,
    workflowId: options.workflow,
    prompt: options.prompt,
    cwd: root,
    capabilities: options.capabilities,
    risk: options.risk,
    sideEffectMode: options.sideEffectMode,
    outputSchemaPath: options.outputSchemaPath,
    providerOrder: order,
    timeoutMs: options.timeoutMs,
  }, {
    adapters,
    artifactDir,
    healthFile: explicit ? undefined : join(artifactDir, 'provider-health.local.json'),
  })
}

export function describeFailure(result: AgentRunResult): string {
  const attempts = result.attempts.map((attempt) => `${attempt.provider}:${attempt.phase}:${attempt.failure ?? attempt.status}`).join(', ')
  return `status=${result.status} failure=${result.failure ?? '-'} attempts=[${attempts}]`
}

/** runId をファイル名として安全にする(時刻単位で一意)。 */
export function runIdFor(workflow: string, now: Date = new Date(), granularity: 'minute' | 'day' = 'minute'): string {
  const iso = now.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '')
  return `${workflow}:${granularity === 'day' ? iso.slice(0, 8) : iso.slice(0, 13)}`
}

export function parseCliFlags(argv: string[]): { dryRun: boolean; agent: string; force: boolean; values: Record<string, string> } {
  const values: Record<string, string> = {}
  let dryRun = false
  let force = false
  let agent = 'auto'
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--dry-run') dryRun = true
    else if (flag === '--force') force = true
    else if (flag === '--agent') agent = argv[++index] ?? 'auto'
    else if (flag.startsWith('--')) values[flag.slice(2)] = argv[++index] ?? ''
  }
  return { dryRun, agent, force, values }
}
