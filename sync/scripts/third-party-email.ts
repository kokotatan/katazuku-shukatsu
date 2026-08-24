/**
 * 本人確認済みメールの唯一の送信入口。
 *
 * prepare: 正本DB・Calendar・文面を検査し、本人へ提示するaction hashを固定する
 * approve/reject: 本人の判断を固定する
 * send: 同じactionを再検査し、Workspace bridge経由で一度だけ送信する
 */
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateJsonSchema } from '../src/agent-runtime'
import { getDatabaseContext, openDb } from '../src/db'
import { resolveDatabasePath } from '../src/database-path'
import {
  buildWorkspaceSendCall,
  hasScheduleCommitmentLanguage,
  preflightThirdPartyEmail,
  type ThirdPartyEmailAction,
} from '../src/third-party-email'
import {
  beginWorkflowStep,
  completeWorkflowStep,
  decideWorkflowApproval,
  failWorkflowStep,
  getWorkflowRun,
  loadWorkflowContract,
  openWorkflowStore,
  requestWorkflowApproval,
  startWorkflowRun,
} from '../src/workflow-control'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repo = join(scriptDir, '..', '..')
const defaultContractPath = join(repo, 'sync', 'workflows', 'third-party-email.json')
const defaultSchemaPath = join(repo, 'sync', 'schemas', 'third-party-email-action.schema.json')

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function required(name: string): string {
  const value = option(name)
  if (!value) throw new Error(`${name} は必須です`)
  return value
}

function readAction(path: string): ThirdPartyEmailAction {
  const action = JSON.parse(readFileSync(resolve(path), 'utf8')) as ThirdPartyEmailAction
  const schema = JSON.parse(readFileSync(defaultSchemaPath, 'utf8'))
  const errors = validateJsonSchema(action, schema)
  if (errors.length) throw new Error(`メールactionがSchemaに一致しません:\n- ${errors.slice(0, 20).join('\n- ')}`)
  return action
}

function runCalendarSync(): void {
  if (process.platform !== 'win32') throw new Error('Calendar同期はMiniPCのWindows上で実行してください')
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(repo, 'scripts', 'calendar-sync.ps1'),
  ], { cwd: repo, windowsHide: true, stdio: 'pipe', timeout: 20 * 60 * 1000, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`Calendar同期に失敗しました(exit=${result.status ?? 'unknown'})`)
}

function normalizeBody(value: string): string {
  return value.replace(/\r\n/g, '\n').trim()
}

function resultText(result: unknown): string {
  const content = (result as { content?: { type?: string; text?: string }[] } | undefined)?.content ?? []
  return content.filter((part) => part.type === 'text').map((part) => part.text ?? '').join('\n')
}

async function executeWorkspaceCall(action: ThirdPartyEmailAction): Promise<{ reconciled: boolean; result: unknown }> {
  const approvedCall = buildWorkspaceSendCall(action)
  const bridge = join(repo, 'scripts', 'workspace-mcp-bridge.mjs')
  const child = spawn(process.execPath, [bridge], {
    cwd: repo,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      KATAZUKU_WORKSPACE_CAPABILITIES: 'gmail.read,gmail.send.confirmed',
      KATAZUKU_APPROVED_WORKSPACE_CALL_B64: Buffer.from(JSON.stringify(approvedCall)).toString('base64url'),
      KATAZUKU_SELF_EMAILS: [
        'okuyama.kotaro@gmail.com',
        'okuyama.kotaro.career@gmail.com',
        'okuyama.kotaro.robotics@gmail.com',
        'okuyama.kotaro.p3@dc.tohoku.ac.jp',
      ].join(','),
    },
  })
  let nextId = 1
  let buffer = ''
  let stderr = ''
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8').slice(-4000) })
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8')
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line) {
        try {
          const message = JSON.parse(line) as { id?: number; result?: unknown; error?: unknown }
          if (message.id && pending.has(message.id)) {
            const request = pending.get(message.id)!
            pending.delete(message.id)
            clearTimeout(request.timer)
            if (message.error) request.reject(new Error(JSON.stringify(message.error)))
            else request.resolve(message.result)
          }
        } catch {
          // bridgeの診断行は無視する。
        }
      }
      newline = buffer.indexOf('\n')
    }
  })
  const request = (method: string, params: unknown): Promise<unknown> => new Promise((resolveRequest, rejectRequest) => {
    const id = nextId++
    const timer = setTimeout(() => {
      pending.delete(id)
      rejectRequest(new Error(`${method}が180秒以内に応答しません`))
    }, 180_000)
    pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  })
  try {
    await request('initialize', {
      protocolVersion: '2024-11-05', capabilities: {},
      clientInfo: { name: 'katazuku-third-party-email', version: '1.0.0' },
    })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`)

    const thread = await request('tools/call', {
      name: 'get_gmail_thread_content',
      arguments: {
        user_google_email: action.target.userGoogleEmail,
        thread_id: action.content.threadId,
      },
    })
    const threadBody = normalizeBody(resultText(thread))
    const lowerThread = threadBody.toLowerCase()
    if (!action.target.to.some((address) => lowerThread.includes(address.toLowerCase()))) {
      throw new Error('元スレッドから送信先メールアドレスを確認できません。宛先を再確認してください')
    }
    if (threadBody.includes(normalizeBody(action.content.body))) {
      return { reconciled: true, result: thread }
    }

    const sent = await request('tools/call', approvedCall)
    if ((sent as { isError?: boolean } | undefined)?.isError) {
      throw new Error(`Gmail送信がエラーを返しました: ${resultText(sent).slice(0, 800)}`)
    }
    return { reconciled: false, result: sent }
  } catch (error) {
    const detail = stderr.trim() ? ` / bridge: ${stderr.trim().slice(-800)}` : ''
    throw new Error(`${(error as Error).message}${detail}`)
  } finally {
    try { child.stdin.end() } catch {}
  }
}

function logActivity(action: ThirdPartyEmailAction, runId: string, result: string): void {
  const logDir = join(repo, 'logs')
  mkdirSync(logDir, { recursive: true })
  appendFileSync(join(logDir, 'activity-log.jsonl'), JSON.stringify({
    ts: new Date().toISOString(),
    by: 'third-party-email',
    action: `${action.target.companyName}へ本人確認済みメールを送信`,
    why: action.notification,
    how: `正本DB・Calendar・文面・重複・action hashを検査。run=${runId}`,
    link: action.content.threadId,
    result,
  }) + '\n', 'utf8')
}

const command = process.argv[2]
if (!command) throw new Error('使用法: third-party-email.ts <prepare|approve|reject|send|status> --run-id <id> --action <json>')
const runId = required('--run-id')
const contract = loadWorkflowContract(resolve(option('--contract') || defaultContractPath))
const actionPath = option('--action')
const action = actionPath ? readAction(actionPath) : undefined
const targetDb = openDb(resolveDatabasePath(option('--db')))
const store = openWorkflowStore(resolve(option('--store') || process.env.KATAZUKU_WORKFLOW_DB ||
  join(repo, 'logs', 'workflow-runtime.local.db')))

try {
  const target = getDatabaseContext(targetDb)
  if (command === 'status') {
    console.log(JSON.stringify(getWorkflowRun(store, runId), null, 2))
    process.exit(0)
  }
  if (!action) throw new Error('--action は必須です')

  if (command === 'prepare') {
    startWorkflowRun(store, contract, action, target, runId)
    try {
      if (hasScheduleCommitmentLanguage(action) || action.content.scheduleCommitments.length) runCalendarSync()
      const preflight = preflightThirdPartyEmail(targetDb, action)
      if (!preflight.ok) throw new Error(preflight.issues.join(' / '))
      beginWorkflowStep(store, contract, runId, 'validate', 'executor', { input: action, targetDatabase: target })
      completeWorkflowStep(store, contract, runId, 'validate', 'executor', { output: preflight, targetDatabase: target })
      const requested = requestWorkflowApproval(store, contract, runId, 'approve', action, target)
      console.log(JSON.stringify({ action, actionHash: requested.actionHash, preflight }, null, 2))
    } catch (error) {
      try { failWorkflowStep(store, contract, runId, 'validate', 'executor', 'unknown', (error as Error).message) } catch {}
      throw error
    }
  } else if (command === 'approve' || command === 'reject') {
    const run = decideWorkflowApproval(store, contract, runId, 'approve', action,
      command === 'approve' ? 'approved' : 'rejected', target)
    console.log(JSON.stringify(run, null, 2))
  } else if (command === 'send') {
    let sideEffectStarted = false
    try {
      if (hasScheduleCommitmentLanguage(action) || action.content.scheduleCommitments.length) runCalendarSync()
      const preflight = preflightThirdPartyEmail(targetDb, action)
      if (!preflight.ok) throw new Error(preflight.issues.join(' / '))
      beginWorkflowStep(store, contract, runId, 'send', 'executor', {
        input: action,
        capabilities: ['gmail.read', 'gmail.send.confirmed'],
        action,
        targetDatabase: target,
      })
      sideEffectStarted = true
      const delivery = await executeWorkspaceCall(action)
      completeWorkflowStep(store, contract, runId, 'send', 'executor', {
        output: delivery,
        outputRef: action.content.threadId,
        action,
        targetDatabase: target,
      })
      beginWorkflowStep(store, contract, runId, 'audit', 'executor', { targetDatabase: target })
      logActivity(action, runId, delivery.reconciled ? '送信済みを照合・再送なし' : '送信成功')
      const done = completeWorkflowStep(store, contract, runId, 'audit', 'executor', {
        output: delivery,
        outputRef: action.content.threadId,
        targetDatabase: target,
      })
      console.log(JSON.stringify({ run: done, delivery }, null, 2))
    } catch (error) {
      try {
        failWorkflowStep(store, contract, runId, 'send', 'executor', 'unknown',
          `${sideEffectStarted ? '送信開始後' : '送信前'}: ${(error as Error).message}`)
      } catch {}
      throw error
    }
  } else {
    throw new Error(`未知のcommandです: ${command}`)
  }
} finally {
  store.close()
  targetDb.close()
}
