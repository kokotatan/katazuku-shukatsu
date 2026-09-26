import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { createHash, timingSafeEqual } from 'node:crypto'
import { SparkQueue } from '../src/spark-queue.js'
import { sparkRpc } from '../src/spark-mcp.js'

const queue = new SparkQueue(process.env.KATAZUKU_SPARK_QUEUE || fileURLToPath(new URL('../logs/spark-queue.local.db', import.meta.url)))
function dispatch(raw: string) {
  try { return sparkRpc(queue, JSON.parse(raw)) }
  catch { return { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } } }
}
if (process.argv.includes('--http')) {
  // 公開TLS/OAuth gatewayを別途用意するまでループバック以外へはbindしない。
  const token = process.env.KATAZUKU_SPARK_TOKEN
  const port = Number(process.env.KATAZUKU_SPARK_PORT || 8797)
  if (!token || token.length < 32) throw new Error('KATAZUKU_SPARK_TOKENは32文字以上必要です')
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('ポートが不正です')
  const digest = (value: string) => createHash('sha256').update(value).digest()
  const expected = digest('Bearer ' + token)
  const server = createServer(async (request, response) => {
    const send = (status: number, data?: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      response.end(data === undefined ? undefined : JSON.stringify(data))
    }
    if (request.headers.host !== `127.0.0.1:${port}` || request.headers.origin) return send(403)
    if (request.url !== '/mcp') return send(404)
    if (!timingSafeEqual(digest(request.headers.authorization || ''), expected)) return send(401)
    if (request.method !== 'POST') return send(405)
    if (!request.headers['content-type']?.startsWith('application/json')) return send(415)
    const version = request.headers['mcp-protocol-version']
    if (version && version !== '2025-06-18') return send(400)
    let bytes = 0; const chunks: Buffer[] = []
    try {
      for await (const chunk of request) {
        bytes += chunk.length
        if (bytes > 1_200_000) return send(413)
        chunks.push(Buffer.from(chunk))
      }
      const result = dispatch(Buffer.concat(chunks).toString('utf8'))
      return send(result === undefined ? 202 : 200, result)
    } catch { return send(400) }
  })
  server.requestTimeout = 30_000
  server.listen(port, '127.0.0.1', () => console.error('Spark MCP: loopback HTTP ready'))
} else {
  let buffer = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk
    if (Buffer.byteLength(buffer) > 1_200_000) { console.error('入力サイズ上限'); process.exit(1) }
    let index: number
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 1)
      if (!line.trim()) continue
      const result = dispatch(line)
      if (result !== undefined) process.stdout.write(JSON.stringify(result) + '\n')
    }
  })
  process.stdin.on('end', () => queue.close())
}
