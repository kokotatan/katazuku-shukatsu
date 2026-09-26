import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { SparkQueue } from '../src/spark-queue.js'
import { sparkRpc } from '../src/spark-mcp.js'
import { allowedSparkRemoteRequest, filterSparkRemoteResponse } from '../src/spark-remote-policy.js'

const root = new URL('../', import.meta.url)
const configPath = process.env.KATAZUKU_SPARK_BRIDGE_CONFIG || fileURLToPath(new URL('logs/spark-bridge.local.json', root))
if (!existsSync(configPath)) { console.error('Spark bridgeの設定がありません'); process.exit(1) }
const config = JSON.parse(readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')) as { origin: string; token: string; queue?: string }
const origin = new URL(config.origin)
if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') throw new Error('HTTPS originが必要です')
if (!/^[A-Za-z0-9_-]{43,128}$/.test(config.token)) throw new Error('bridge tokenが不正です')
const queue = new SparkQueue(config.queue || fileURLToPath(new URL('logs/spark-queue.local.db', root)))
let stopped = false, socket: WebSocket | undefined, retry = 1000
const seen = new Set<string>()
function connect() {
  if (stopped) return
  socket = new WebSocket(config.origin.replace(/^https:/, 'wss:') + '/bridge', ['katazuku-spark', 'auth.' + config.token])
  const current = socket
  let lastPong = Date.now()
  const heartbeat = setInterval(() => {
    if (Date.now() - lastPong > 90_000) { current.close(); return }
    if (current.readyState === WebSocket.OPEN) current.send('ping')
  }, 30_000)
  current.addEventListener('open', () => { retry = 1000; console.log('Spark bridge connected') })
  current.addEventListener('message', event => {
    if (event.data === 'pong') { lastPong = Date.now(); return }
    if (typeof event.data !== 'string' || event.data.length > 130_000) return
    try {
      const message = JSON.parse(event.data)
      if (typeof message.id !== 'string' || seen.has(message.id) || !Number.isFinite(message.expiresAt) || message.expiresAt < Date.now() || message.expiresAt > Date.now() + 30_000) return
      seen.add(message.id); if (seen.size > 1000) seen.delete(seen.values().next().value!)
      const input = JSON.parse(message.body)
      if (!allowedSparkRemoteRequest(input)) return
      const result = filterSparkRemoteResponse(sparkRpc(queue, input))
      current.send(JSON.stringify({ id: message.id, result, notification: result === undefined }))
    } catch { console.error('Spark bridge request rejected') }
  })
  current.addEventListener('error', () => { /* 接続先URLや認証headerをログへ出さない */ })
  current.addEventListener('close', () => { clearInterval(heartbeat); if (!stopped) { setTimeout(connect, retry); retry = Math.min(retry * 2, 60_000) } })
}
function stop() { stopped = true; socket?.close(); queue.close(); process.exit(0) }
process.on('SIGINT', stop); process.on('SIGTERM', stop)
connect()
