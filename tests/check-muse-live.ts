import assert from 'node:assert/strict'
import { verifyMuseLive } from '../src/muse-live.js'

const origin = 'https://katazuku-muse.example.workers.dev'
const calls: Array<{ path: string; method: string; origin?: string | null }> = []
const reply = (url: string, value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } })
const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = new URL(String(input))
  calls.push({ path: url.pathname, method: init?.method || 'GET', origin: new Headers(init?.headers).get('Origin') })
  if (url.pathname === '/health') return reply(url.href, { service: 'katazuku-muse-gateway' }, 200, { 'Cache-Control': 'no-store' })
  if (url.pathname === '/bridge') return reply(url.href, { error: 'unauthorized' }, 401)
  if (url.pathname === '/mcp' && new Headers(init?.headers).get('Origin')) return reply(url.href, { error: 'invalid_origin' }, 403)
  if (url.pathname === '/mcp') return reply(url.href, { error: 'unauthorized' }, 401)
  if (url.pathname === '/.well-known/oauth-authorization-server') return reply(url.href, {
    authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`, revocation_endpoint: `${origin}/oauth/token`,
    scopes_supported: ['katazuku:read', 'katazuku:write', 'katazuku:sensitive', 'katazuku:actions'],
  })
  return reply(url.href, { error: 'not_found' }, 404)
}

const evidence = await verifyMuseLive(origin, fakeFetch)
assert.equal(evidence.secretsUsed, false)
assert.equal(evidence.oauthGrantCreated, false)
assert.equal(evidence.endpoints.revocation, `${origin}/oauth/token`)
assert.deepEqual(calls.map((call) => call.path), ['/health', '/mcp', '/bridge', '/mcp', '/.well-known/oauth-authorization-server'])
await assert.rejects(() => verifyMuseLive('http://localhost:8787', fakeFetch), /HTTPS/)
await assert.rejects(() => verifyMuseLive('https://example.com', fakeFetch), /example/)
await assert.rejects(() => verifyMuseLive(`${origin}/path`, fakeFetch), /path/)
console.log('Muse live verifier: TLS、health、MCP/bridge認証、Origin拒否、OAuth discoveryを秘密なしで確認')
