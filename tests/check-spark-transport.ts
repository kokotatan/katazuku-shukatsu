import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { request as httpRequest } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = mkdtempSync(join(tmpdir(), 'spark-mcp-'))
const reserve = createServer()
await new Promise<void>(resolve => reserve.listen(0, '127.0.0.1', resolve))
const port = (reserve.address() as { port: number }).port
await new Promise<void>(resolve => reserve.close(() => resolve()))
const token = randomBytes(32).toString('hex')
const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../scripts/spark-mcp.ts', import.meta.url)), '--http'], {
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  env: { ...process.env, KATAZUKU_SPARK_TOKEN: token, KATAZUKU_SPARK_PORT: String(port), KATAZUKU_SPARK_QUEUE: join(dir, 'queue.db') }, stdio: ['ignore', 'pipe', 'pipe'],
})
const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))
try {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('MCP起動タイムアウト')), 10_000)
    child.stderr.on('data', (data: Buffer) => { if (data.toString().includes('HTTP ready')) { clearTimeout(timer); resolve() } })
    child.once('error', reject)
  })
  const url = `http://127.0.0.1:${port}/mcp`
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }
  const call = (body: unknown, extra: Record<string, string> = {}) => fetch(url, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) })
  assert.equal((await fetch(url)).status, 401)
  assert.equal((await fetch(url, { headers })).status, 405)
  assert.equal((await call({}, { Origin: 'https://example.com' })).status, 403)
  const hostStatus = await new Promise<number | undefined>((resolve, reject) => {
    const req = httpRequest(url, { method: 'POST', headers: { ...headers, Host: 'example.com' } }, res => { res.resume(); resolve(res.statusCode) })
    req.on('error', reject); req.end('{}')
  })
  assert.equal(hostStatus, 403)
  assert.equal((await call({}, { 'MCP-Protocol-Version': 'unknown' })).status, 400)
  assert.equal((await fetch(url + '?token=' + token, { headers })).status, 404)
  assert.equal((await call({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202)
  const init = await (await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })).json()
  assert.equal(init.result.serverInfo.name, 'katazuku-spark')
  const invoke = async (name: string, args: unknown) => (await call({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } })).json()
  const queued = await invoke('spark_enqueue', { requestKey: 'example:http', kind: 'document', input: '架空資料' })
  assert.equal(queued.result.isError, false)
  assert.equal((await invoke('shell', { command: 'echo test' })).error.code, -32602)
  const claim = JSON.parse((await invoke('spark_claim', {})).result.content[0].text)
  assert.equal(claim.operation, 'dispatch')
  assert.equal(JSON.parse((await invoke('spark_claim', {})).result.content[0].text), null)
  console.log('Spark HTTP MCP: 実サーバーの認証・Origin/Host・URL秘密値拒否・protocol・キュー操作 OK')
} finally {
  child.kill()
  await exited
  rmSync(dir, { recursive: true, force: true })
}
