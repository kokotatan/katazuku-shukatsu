import { spawn, spawnSync } from 'node:child_process'
import { blockedToolResult, evaluateWorkspaceToolCall } from './google-workspace-policy.mjs'

function parseJsonArray(name, fallback = []) {
  const raw = process.env[name]
  if (!raw) return fallback
  try {
    const value = JSON.parse(raw)
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error()
    return value
  } catch {
    throw new Error(`${name}は文字列配列のJSONで指定してください`)
  }
}

function parseList(name) {
  const raw = process.env[name] || ''
  if (!raw) return []
  if (raw.trim().startsWith('[')) return parseJsonArray(name)
  return raw.split(',').map((value) => value.trim()).filter(Boolean)
}

function parseApprovedCall() {
  const encoded = process.env.KATAZUKU_APPROVED_WORKSPACE_CALL_B64 || ''
  delete process.env.KATAZUKU_APPROVED_WORKSPACE_CALL_B64
  if (!encoded) return undefined
  try {
    const value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    if (!value || typeof value !== 'object' || typeof value.name !== 'string' || typeof value.arguments !== 'object') throw new Error()
    return value
  } catch {
    throw new Error('KATAZUKU_APPROVED_WORKSPACE_CALL_B64が不正です')
  }
}

const command = process.env.KATAZUKU_GOOGLE_MCP_COMMAND || 'uvx'
const args = parseJsonArray('KATAZUKU_GOOGLE_MCP_ARGS_JSON', ['workspace-mcp', '--tools', 'gmail', 'calendar'])
const selfEmails = parseList('KATAZUKU_WORKSPACE_SELF_EMAILS')
const allowedSenderEmails = parseList('KATAZUKU_WORKSPACE_ALLOWED_SENDERS')
const capabilities = parseList('KATAZUKU_WORKSPACE_CAPABILITIES')
let approvedCall = parseApprovedCall()

const essentialEnv = new Set([
  'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SystemDrive', 'windir', 'ComSpec',
  'TEMP', 'TMP', 'TMPDIR', 'HOME', 'HOMEDRIVE', 'HOMEPATH', 'USERPROFILE', 'USERNAME',
  'APPDATA', 'LOCALAPPDATA', 'LANG', 'LC_ALL', 'TZ', 'PYTHONIOENCODING', 'PYTHONUTF8',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY',
  'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'USER_GOOGLE_EMAIL',
  'KATAZUKU_GOOGLE_CREDENTIALS_DIR',
  ...parseList('KATAZUKU_GOOGLE_MCP_ENV_ALLOWLIST'),
])
const childEnv = {}
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined && essentialEnv.has(key)) childEnv[key] = value
}
childEnv.PYTHONIOENCODING = 'utf-8'
childEnv.PYTHONUTF8 = '1'

const child = spawn(command, args, {
  cwd: process.cwd(),
  env: childEnv,
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
})
child.stdin.on('error', () => {})

let childExited = false
let shutdownStarted = false
let shutdownTimer

function forceStopChildTree() {
  if (childExited || !child.pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    return
  }
  try { child.kill('SIGKILL') } catch {}
}

function beginShutdown(exitCode = 0) {
  if (shutdownStarted) return
  shutdownStarted = true
  try { child.stdin.end() } catch {}
  shutdownTimer = setTimeout(() => {
    forceStopChildTree()
    if (!childExited) process.exit(exitCode)
  }, 1500)
}

let stdinBuffer = ''
function forwardLine(line) {
  if (!line.trim()) return
  let message
  try {
    message = JSON.parse(line)
  } catch {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null,
      error: { code: -32700, message: 'Invalid JSON-RPC input' } }) + '\n')
    return
  }
  try {
    const verdict = evaluateWorkspaceToolCall(message, {
      selfEmails,
      allowedSenderEmails,
      capabilities,
      approvedCall,
    })
    if (!verdict.allow) {
      process.stdout.write(JSON.stringify(blockedToolResult(message.id, verdict.reason)) + '\n')
      return
    }
    if (verdict.consumeApproval) approvedCall = undefined
  } catch {
    // 検証処理が例外になってもupstreamへ流さない。
    process.stdout.write(JSON.stringify(blockedToolResult(message?.id ?? null, 'Google Workspaceの操作検証に失敗したため拒否しました。')) + '\n')
    return
  }
  child.stdin.write(line + '\n')
}

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  stdinBuffer += chunk
  const lines = stdinBuffer.split(/\r?\n/)
  stdinBuffer = lines.pop() || ''
  for (const line of lines) forwardLine(line)
})
process.stdin.on('end', () => {
  if (stdinBuffer) forwardLine(stdinBuffer)
  beginShutdown()
})
process.stdin.on('close', () => beginShutdown())
child.stdout.pipe(process.stdout)
child.stderr.pipe(process.stderr)

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => beginShutdown(1))
process.once('exit', forceStopChildTree)
process.once('uncaughtException', (error) => {
  console.error(`google-workspace bridgeで未処理例外: ${error.message}`)
  forceStopChildTree()
  process.exit(1)
})
process.once('unhandledRejection', (error) => {
  console.error(`google-workspace bridgeで未処理拒否: ${String(error)}`)
  forceStopChildTree()
  process.exit(1)
})

child.on('error', (error) => {
  console.error(`google-workspace MCPを起動できません: ${error.message}`)
  beginShutdown(1)
})
child.on('exit', (code, signal) => {
  childExited = true
  if (shutdownTimer) clearTimeout(shutdownTimer)
  process.exit(signal ? 1 : (code ?? 1))
})
