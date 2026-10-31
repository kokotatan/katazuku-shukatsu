import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { resolveDatabasePath } from '../src/data-path.js'
import {
  defaultWorkflowStorePath,
  katazukuRpc,
  KATAZUKU_MCP_SCOPES,
  KatazukuMcpServer,
  type KatazukuMcpScope,
} from '../src/katazuku-mcp.js'

function scopesFromEnv(value = process.env.KATAZUKU_MCP_SCOPES ?? 'read'): KatazukuMcpScope[] {
  const scopes = [...new Set(value.split(',').map((part) => part.trim()).filter(Boolean))]
  for (const scope of scopes) if (!KATAZUKU_MCP_SCOPES.includes(scope as KatazukuMcpScope)) throw new Error(`未知のMCP scopeです: ${scope}`)
  return scopes as KatazukuMcpScope[]
}

const dbPath = resolveDatabasePath(process.env.KATAZUKU_MCP_DB)
const workflowStorePath = resolve(process.env.KATAZUKU_MCP_WORKFLOW_STORE || defaultWorkflowStorePath(dbPath))
const mcp = new KatazukuMcpServer({ dbPath, workflowStorePath, scopes: scopesFromEnv() })

async function dispatch(raw: string): Promise<unknown | undefined> {
  try { return await katazukuRpc(mcp, JSON.parse(raw)) }
  catch { return { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } } }
}

if (process.argv.includes('--http')) {
  // TLS/OAuthの前段を置く場合も、このプロセス自体はloopbackから出さない。
  const token = process.env.KATAZUKU_MCP_TOKEN
  const port = Number(process.env.KATAZUKU_MCP_PORT || 8798)
  if (!token || token.length < 32) throw new Error('KATAZUKU_MCP_TOKENは32文字以上必要です')
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('KATAZUKU_MCP_PORTが不正です')
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
    let bytes = 0
    const chunks: Buffer[] = []
    try {
      for await (const chunk of request) {
        bytes += chunk.length
        if (bytes > 1_200_000) return send(413)
        chunks.push(Buffer.from(chunk))
      }
      const result = await dispatch(Buffer.concat(chunks).toString('utf8'))
      return send(result === undefined ? 202 : 200, result)
    } catch { return send(400) }
  })
  server.requestTimeout = 30_000
  server.listen(port, '127.0.0.1', () => console.error('katazuku MCP: loopback HTTP ready'))
} else {
  let chain = Promise.resolve()
  let buffer = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk
    if (Buffer.byteLength(buffer) > 1_200_000) { console.error('入力サイズ上限'); process.exit(1) }
    let index: number
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index)
      buffer = buffer.slice(index + 1)
      if (!line.trim()) continue
      chain = chain.then(async () => {
        const result = await dispatch(line)
        if (result !== undefined) process.stdout.write(JSON.stringify(result) + '\n')
      })
    }
  })
}
