import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDatabasePath } from '../src/data-path.js'
import { defaultWorkflowStorePath, katazukuRpc, KatazukuMcpServer, type KatazukuMcpScope } from '../src/katazuku-mcp.js'
import { allowedKatazukuRemoteRequest, KATAZUKU_REMOTE_SCOPES, localScopes } from '../src/katazuku-remote-policy.js'

const repository = new URL('../', import.meta.url)
const configPath = process.env.KATAZUKU_MUSE_BRIDGE_CONFIG || fileURLToPath(new URL('logs/muse-bridge.local.json', repository))
if (!existsSync(configPath)) { console.error('Muse bridgeの設定がありません'); process.exit(1) }
const config = JSON.parse(readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')) as {
  origin: string
  token: string
  scopes?: string[]
  dbPath?: string
  workflowStorePath?: string
}
const origin = new URL(config.origin)
const testLoopback = process.env.KATAZUKU_MUSE_BRIDGE_TEST_LOOPBACK === '1'
  && origin.protocol === 'http:'
  && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)
if ((!testLoopback && origin.protocol !== 'https:') || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
  throw new Error('HTTPS originが必要です')
}
if (!/^[A-Za-z0-9_-]{43,128}$/.test(config.token)) throw new Error('bridge tokenが不正です')
const allowedScopes = new Set(config.scopes?.length ? config.scopes : ['katazuku:read'])
for (const scope of allowedScopes) if (!KATAZUKU_REMOTE_SCOPES.includes(scope as typeof KATAZUKU_REMOTE_SCOPES[number])) throw new Error(`bridge scopeが不正です: ${scope}`)
const dbPath = resolveDatabasePath(config.dbPath)
const workflowStorePath = resolve(config.workflowStorePath || defaultWorkflowStorePath(dbPath))
let stopped = false
let socket: WebSocket | undefined
let retry = 1_000
const seen = new Set<string>()

function connect(): void {
  if (stopped) return
  const socketOrigin = config.origin.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:')
  socket = new WebSocket(socketOrigin + '/bridge', ['katazuku-muse', `auth.${config.token}`])
  const current = socket
  let lastPong = Date.now()
  const heartbeat = setInterval(() => {
    if (Date.now() - lastPong > 90_000) { current.close(); return }
    if (current.readyState === WebSocket.OPEN) current.send('ping')
  }, 30_000)
  current.addEventListener('open', () => { retry = 1_000; console.log('Muse bridge connected') })
  current.addEventListener('message', (event) => {
    if (event.data === 'pong') { lastPong = Date.now(); return }
    if (typeof event.data !== 'string' || event.data.length > 1_300_000) return
    void (async () => {
      try {
        const message = JSON.parse(event.data) as { id?: unknown; body?: unknown; scopes?: unknown; expiresAt?: unknown }
        if (typeof message.id !== 'string' || seen.has(message.id) || typeof message.body !== 'string' || !Array.isArray(message.scopes)
          || !Number.isFinite(message.expiresAt) || Number(message.expiresAt) < Date.now() || Number(message.expiresAt) > Date.now() + 30_000) return
        const remoteScopes = message.scopes.filter((scope): scope is string => typeof scope === 'string' && allowedScopes.has(scope))
        const input = JSON.parse(message.body)
        if (!allowedKatazukuRemoteRequest(input, remoteScopes)) return
        seen.add(message.id)
        if (seen.size > 1_000) seen.delete(seen.values().next().value!)
        if (input.method === 'tools/call') console.log(`${new Date().toISOString()} tools/call ${String(input.params?.name)}`)
        const server = new KatazukuMcpServer({ dbPath, workflowStorePath, scopes: localScopes(remoteScopes) as KatazukuMcpScope[] })
        const result = await katazukuRpc(server, input)
        current.send(JSON.stringify({ id: message.id, result, notification: result === undefined }))
      } catch { console.error('Muse bridge request rejected') }
    })()
  })
  current.addEventListener('error', () => { /* URLや認証情報をログへ出さない。 */ })
  current.addEventListener('close', () => {
    clearInterval(heartbeat)
    if (!stopped) { setTimeout(connect, retry); retry = Math.min(retry * 2, 60_000) }
  })
}

function stop(): void { stopped = true; socket?.close(); process.exit(0) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
connect()
