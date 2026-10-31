import assert from 'node:assert/strict'

export type MuseLiveEvidence = {
  schemaVersion: 1
  verifiedAt: string
  origin: string
  service: string
  endpoints: {
    authorization: string
    token: string
    registration: string
    revocation: string
  }
  scopes: string[]
  checks: string[]
  secretsUsed: false
  oauthGrantCreated: false
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

const expectedScopes = ['katazuku:read', 'katazuku:write', 'katazuku:sensitive', 'katazuku:actions']

const exactOrigin = (raw: string): string => {
  const url = new URL(raw)
  assert.equal(url.protocol, 'https:', 'live origin must use HTTPS')
  assert.equal(raw, url.origin, 'live origin must not contain a path, query, fragment, or trailing slash')
  assert.equal(url.username || url.password, '', 'live origin must not contain credentials')
  assert.equal(/(^|\.)(example\.(com|org|net)|localhost)$/i.test(url.hostname) || url.hostname === '127.0.0.1', false, 'live origin must not be an example or loopback host')
  return url.origin
}

const json = async (response: Response): Promise<Record<string, any>> => {
  assert.match(response.headers.get('content-type') || '', /^application\/json\b/i)
  return await response.json() as Record<string, any>
}

export async function verifyMuseLive(rawOrigin: string, fetcher: FetchLike = fetch): Promise<MuseLiveEvidence> {
  const origin = exactOrigin(rawOrigin)
  const request = async (path: string, init?: RequestInit) => {
    const response = await fetcher(`${origin}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(10_000), ...init })
    assert.equal(new URL(response.url || `${origin}${path}`).origin, origin, `unexpected redirect or response origin for ${path}`)
    return response
  }

  const health = await request('/health')
  assert.equal(health.status, 200)
  assert.match(health.headers.get('cache-control') || '', /no-store/i)
  const healthBody = await json(health)
  assert.equal(healthBody.service, 'katazuku-muse-gateway')

  const unauthenticatedMcp = await request('/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
  })
  assert.equal(unauthenticatedMcp.status, 401, 'MCP must reject unauthenticated requests')
  const bridge = await request('/bridge')
  assert.equal(bridge.status, 401, 'bridge must reject requests without its secret subprotocol')
  const hostileOrigin = await request('/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example' },
    body: '{}',
  })
  assert.equal(hostileOrigin.status, 403, 'foreign Origin must be rejected before OAuth')

  const discoveryResponse = await request('/.well-known/oauth-authorization-server')
  assert.equal(discoveryResponse.status, 200)
  const discovery = await json(discoveryResponse)
  const endpoints = {
    authorization: `${origin}/authorize`, token: `${origin}/oauth/token`,
    registration: `${origin}/oauth/register`, revocation: `${origin}/oauth/token`,
  }
  assert.equal(discovery.authorization_endpoint, endpoints.authorization)
  assert.equal(discovery.token_endpoint, endpoints.token)
  assert.equal(discovery.registration_endpoint, endpoints.registration)
  assert.equal(discovery.revocation_endpoint, endpoints.revocation)
  assert.deepEqual(discovery.scopes_supported, expectedScopes)
  for (const endpoint of Object.values(endpoints)) assert.equal(new URL(endpoint).origin, origin)

  return {
    schemaVersion: 1,
    verifiedAt: new Date().toISOString(),
    origin,
    service: String(healthBody.service),
    endpoints,
    scopes: expectedScopes,
    checks: ['TLS origin', 'health no-store', 'MCP authentication', 'bridge authentication', 'Origin rejection', 'OAuth discovery'],
    secretsUsed: false,
    oauthGrantCreated: false,
  }
}
