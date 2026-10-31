import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb } from '../src/db.js'

const root = mkdtempSync(join(tmpdir(), 'katazuku-mcp-http-'))
const dbPath = join(root, 'katazuku.db')
openDb(dbPath).close()
const reserve = createServer()
await new Promise<void>((resolve) => reserve.listen(0, '127.0.0.1', resolve))
const port = (reserve.address() as { port: number }).port
await new Promise<void>((resolve) => reserve.close(() => resolve()))
const token = randomBytes(32).toString('hex')
const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../scripts/katazuku-mcp.ts', import.meta.url)), '--http'], {
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  env: { ...process.env, KATAZUKU_MCP_DB: dbPath, KATAZUKU_MCP_WORKFLOW_STORE: join(root, 'workflow.db'), KATAZUKU_MCP_SCOPES: 'read', KATAZUKU_MCP_TOKEN: token, KATAZUKU_MCP_PORT: String(port) },
  stdio: ['ignore', 'ignore', 'pipe'],
})
const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
try {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('MCP起動タイムアウト')), 10_000)
    child.stderr.on('data', (data: Buffer) => { if (data.toString().includes('HTTP ready')) { clearTimeout(timer); resolve() } })
    child.once('error', reject)
  })
  const url = `http://127.0.0.1:${port}/mcp`
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }
  const call = (body: unknown, extra: Record<string, string> = {}) => fetch(url, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) })
  assert.equal((await fetch(url)).status, 401)
  assert.equal((await call({}, { Origin: 'https://example.com' })).status, 403)
  assert.equal((await call({}, { 'MCP-Protocol-Version': 'unknown' })).status, 400)
  assert.equal((await fetch(`${url}?token=${token}`, { headers })).status, 404)
  const init = await (await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })).json() as any
  assert.equal(init.result.serverInfo.name, 'katazuku-shukatsu')
  const tools = await (await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json() as any
  assert(tools.result.tools.some((tool: { name: string }) => tool.name === 'katazuku_today'))
  assert(!tools.result.tools.some((tool: { name: string }) => tool.name === 'katazuku_snapshot'))
  console.log('katazuku HTTP MCP: bearer認証・loopback/Origin・protocol・URL秘密値拒否・scopeを確認')
} finally {
  child.kill()
  await exited
  rmSync(root, { recursive: true, force: true })
}
