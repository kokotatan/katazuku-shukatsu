import { timingSafeEqual } from 'node:crypto'
import { boundedJson, BodyError, connectionOrigin } from '../src/http-boundary'
import { MAX_SNAPSHOT_BYTES, validateSnapshot } from '../src/snapshot-contract'
import { passwordAuth, authenticatePasswordProof, passwordConfigured, passwordRevision, passwordSession } from './password-auth'

const SNAPSHOT_KEY = 'snapshot.json'
const SESSION_SECONDS = 30 * 60
const PAIR_SECONDS = 5 * 60
const encoder = new TextEncoder()
class HttpError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code) }
}
const json = (body: unknown, status = 200, headers?: HeadersInit) => Response.json(body, { status, headers })
const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), b => b.toString(16).padStart(2, '0')).join('')
async function equal(provided: string, expected: string): Promise<boolean> {
  const values = await Promise.all([provided, expected].map(value => crypto.subtle.digest('SHA-256', encoder.encode(value))))
  return timingSafeEqual(new Uint8Array(values[0]), new Uint8Array(values[1]))
}
function credentials(env: Env) {
  const read = env.KATAZUKU_READ_SECRET
  const write = env.KATAZUKU_WRITE_SECRET
  // セットアップ側が生成する256bit以上の別々の値。人が覚えるパスワードには使わない。
  if (![read, write].every(value => typeof value === 'string' && /^[A-Za-z0-9_-]{43,128}$/.test(value)) || read === write) throw new HttpError(503, 'setup_required')
  return { read, write }
}
async function instanceId(request: Request, env: Env): Promise<string> {
  return (await digest(`katazuku-v1\0${new URL(request.url).origin}\0${credentials(env).read}`)).slice(0, 32)
}
function allowedOrigins(request: Request, env: Env): Set<string> {
  try {
    return new Set([new URL(request.url).origin, ...(env.KATAZUKU_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean).map(connectionOrigin)])
  } catch { throw new HttpError(503, 'setup_required') }
}
function requestOrigin(request: Request): string { return request.headers.get('origin') ?? new URL(request.url).origin }
function bearer(request: Request): string { return /^Bearer ([A-Za-z0-9_-]+)$/.exec(request.headers.get('authorization') || '')?.[1] || '' }
async function requireWrite(request: Request, env: Env): Promise<void> {
  if (!await equal(bearer(request), credentials(env).write)) throw new HttpError(401, 'unauthorized')
}
async function limit(request: Request, env: Env, auth = false): Promise<void> {
  const binding = auth ? env.AUTH_LIMIT : env.REQUEST_LIMIT
  if (!binding) throw new HttpError(503, 'setup_required')
  // 認証前の乱用抑制。共有IPへの影響を抑えるため、短い期間だけ制限する。
  const key = await digest(`${new URL(request.url).origin}\0${request.headers.get('cf-connecting-ip') || 'local'}`)
  if (!(await binding.limit({ key })).success) throw new HttpError(429, 'try_later')
}
type StoredAccess = { instanceId: string; origin: string; expiresAt: number; credentialHash: string; passwordRevision: string }
function newToken(kind: 'session' | 'pair', seconds: number) {
  const expiresAt = Math.floor(Date.now() / 1000) + seconds
  const random = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  return { token: `ktz_${kind}_${expiresAt}_${random}`, expiresAt }
}
async function accessKey(token: string, kind: 'session' | 'pair'): Promise<string> {
  const match = new RegExp(`^ktz_${kind}_(\\d{10})_[A-Za-z0-9_-]{43}$`).exec(token)
  if (!match || Number(match[1]) <= Date.now() / 1000) throw new HttpError(401, 'unauthorized')
  return `auth/${kind}/${match[1]}/${await digest(token)}`
}
async function accessRecord(request: Request, env: Env, token: string, kind: 'session' | 'pair') {
  const key = await accessKey(token, kind)
  const object = await env.PRIVATE_DATA.get(key)
  if (!object || object.size > 4096) throw new HttpError(401, 'unauthorized')
  const record = await object.json<StoredAccess>()
  if (record.instanceId !== await instanceId(request, env) || record.origin !== requestOrigin(request)
    || !Number.isFinite(record.expiresAt) || record.expiresAt <= Date.now() / 1000
    || !await equal(record.credentialHash || '', await digest(credentials(env).write))
    || (record.passwordRevision || 'legacy') !== await passwordRevision(env)) throw new HttpError(401, 'unauthorized')
  return { key, record, etag: object.etag }
}
async function createAccess(request: Request, env: Env, kind: 'session' | 'pair', origin: string, revision?: string) {
  const { token, expiresAt } = newToken(kind, kind === 'session' ? SESSION_SECONDS : PAIR_SECONDS)
  const id = await instanceId(request, env)
  const record: StoredAccess = { instanceId: id, origin, expiresAt, credentialHash: await digest(credentials(env).write), passwordRevision: revision ?? await passwordRevision(env) }
  const object = await env.PRIVATE_DATA.put(await accessKey(token, kind), JSON.stringify(record), { onlyIf: { etagDoesNotMatch: '*' } })
  if (!object) throw new HttpError(503, 'retry_connection')
  return { token, expiresAt: expiresAt * 1000, instanceId: id, protocolVersion: 1 }
}
async function bodyRecord(request: Request): Promise<Record<string, unknown>> {
  const body = await boundedJson(request, 4096)
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'invalid_request')
  return body as Record<string, unknown>
}
async function session(request: Request, env: Env): Promise<Response> {
  if (request.method === 'DELETE') {
    const { key } = await accessRecord(request, env, bearer(request), 'session')
    await env.PRIVATE_DATA.delete(key)
    return json({ ok: true })
  }
  if (request.method !== 'POST') throw new HttpError(405, 'method_not_allowed')
  await limit(request, env, true)
  const body = await bodyRecord(request)
  if (body.instanceId !== await instanceId(request, env)) throw new HttpError(409, 'connection_changed')
  let revision = await passwordRevision(env)
  if (typeof body.pairingCode === 'string' && Object.keys(body).length === 2) {
    const record = await accessRecord(request, env, body.pairingCode, 'pair')
    // get→deleteでは同時に2回利用できる。ETag条件付き更新で一度だけ消費する。
    const consumed = await env.PRIVATE_DATA.put(record.key, JSON.stringify({ consumed: true }), { onlyIf: { etagMatches: record.etag } })
    if (!consumed) throw new HttpError(401, 'unauthorized')
  } else if (typeof body.readKey === 'string' && Object.keys(body).length === 2) {
    if (await passwordConfigured(env) || !await equal(body.readKey, credentials(env).read)) throw new HttpError(401, 'unauthorized')
  } else if (typeof body.passwordProof === 'string' && Object.keys(body).length === 2) {
    const config = await authenticatePasswordProof(env, body.passwordProof)
    if (!config) throw new HttpError(401, 'unauthorized')
    revision = config.revision
  } else if (body.browserSession === true && Object.keys(body).length === 2) {
    if (requestOrigin(request) !== new URL(request.url).origin || !await passwordSession(request, env)) throw new HttpError(401, 'unauthorized')
  } else throw new HttpError(400, 'invalid_request')
  const access = await createAccess(request, env, 'session', requestOrigin(request), revision)
  return json({ ...access, deviceName: (env.KATAZUKU_DEVICE_NAME || '自分のPC').slice(0, 80) })
}
async function pair(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') throw new HttpError(405, 'method_not_allowed')
  await requireWrite(request, env)
  const body = await bodyRecord(request)
  if (typeof body.origin !== 'string' || Object.keys(body).length !== 1 || !allowedOrigins(request, env).has(body.origin)) throw new HttpError(400, 'invalid_origin')
  return json(await createAccess(request, env, 'pair', body.origin))
}
async function push(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'PUT') throw new HttpError(405, 'method_not_allowed')
  await requireWrite(request, env)
  const sourceId = request.headers.get('x-katazuku-source') || ''
  if (!/^[a-f0-9-]{36}$/.test(sourceId)) throw new HttpError(400, 'source_required')
  const expected = request.headers.get('if-match')
  const first = request.headers.get('if-none-match') === '*'
  if ((!expected && !first) || (expected && first)) throw new HttpError(428, 'version_required')
  const value = await boundedJson(request, MAX_SNAPSHOT_BYTES)
  try { validateSnapshot(value) } catch { throw new HttpError(422, 'invalid_snapshot') }
  const snapshot = value as Record<string, unknown>
  const generatedAt = snapshot.generatedAt as string
  if (Date.parse(generatedAt) > Date.now() + 5 * 60_000) throw new HttpError(422, 'invalid_snapshot_time')
  const previous = await env.PRIVATE_DATA.head(SNAPSHOT_KEY)
  if ((previous && expected !== previous.httpEtag) || (!previous && !first)) throw new HttpError(412, 'sync_conflict')
  if (previous && previous.customMetadata?.sourceId !== sourceId) throw new HttpError(409, 'source_changed')
  const body = JSON.stringify(value)
  const hash = await digest(body)
  if (previous && Date.parse(generatedAt) <= Date.parse(previous.customMetadata?.generatedAt || '')) {
    if (previous.customMetadata?.hash === hash) return json({ ok: true, etag: previous.httpEtag, unchanged: true })
    throw new HttpError(409, 'older_snapshot')
  }
  const stored = await env.PRIVATE_DATA.put(SNAPSHOT_KEY, body, {
    onlyIf: previous ? { etagMatches: previous.etag } : { etagDoesNotMatch: '*' },
    httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' },
    customMetadata: { sourceId, generatedAt, hash },
  })
  if (!stored) throw new HttpError(412, 'sync_conflict')
  return json({ ok: true, etag: stored.httpEtag })
}
async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  try { connectionOrigin(url.origin) } catch { throw new HttpError(400, 'https_required') }
  if (url.search) throw new HttpError(400, 'query_not_supported')
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 })
  if (!url.pathname.startsWith('/api/') && url.pathname !== '/health' && env.ASSETS) return env.ASSETS.fetch(request)
  if (url.pathname === '/health' && request.method === 'GET') return json({ ok: true })
  await limit(request, env)
  const auth = await passwordAuth(request, env)
  if (auth) return auth
  if (url.pathname === '/api/info' && request.method === 'GET') return json({ protocolVersion: 1, instanceId: await instanceId(request, env) })
  if (url.pathname === '/api/session') return await session(request, env)
  if (url.pathname === '/api/pair') return await pair(request, env)
  if (url.pathname === '/api/push') return await push(request, env)
  if (url.pathname === '/api/sync-state' && request.method === 'GET') {
    await requireWrite(request, env)
    const object = await env.PRIVATE_DATA.head(SNAPSHOT_KEY)
    return json({ etag: object?.httpEtag ?? null, sourceId: object?.customMetadata?.sourceId ?? null })
  }
  if (url.pathname === '/api/data' && request.method === 'GET') {
    await accessRecord(request, env, bearer(request), 'session')
    const object = await env.PRIVATE_DATA.get(SNAPSHOT_KEY)
    if (!object) throw new HttpError(404, 'not_synced')
    if (object.size > MAX_SNAPSHOT_BYTES) throw new HttpError(503, 'snapshot_unavailable')
    return new Response(object.body, { headers: { 'Content-Type': 'application/json', ETag: object.httpEtag } })
  }
  throw new HttpError(404, 'not_found')
}
/** 期限順のキーを先頭から回収する。1回の処理件数を制限し、次の実行で続ける。 */
async function collectExpired(env: Env): Promise<void> {
  for (const kind of ['session', 'pair']) {
    for (let page = 0; page < 4; page++) {
      const listing = await env.PRIVATE_DATA.list({ prefix: `auth/${kind}/`, limit: 500 })
      const expired = listing.objects.filter(object => Number(object.key.split('/')[2]) <= Date.now() / 1000).map(object => object.key)
      if (expired.length) await env.PRIVATE_DATA.delete(expired)
      if (expired.length < 500) break
    }
  }
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let response: Response
    let origin: string | null = null
    try {
      const requested = request.headers.get('origin')
      if (requested && !allowedOrigins(request, env).has(requested)) throw new HttpError(403, 'origin_denied')
      origin = requested
      response = await route(request, env)
    } catch (error) {
      if (error instanceof HttpError) response = json({ error: error.code }, error.status, error.status === 429 ? { 'Retry-After': '60' } : undefined)
      else if (error instanceof BodyError) response = json({ error: 'invalid_body' }, error.status)
      else {
        console.error(JSON.stringify({ level: 'error', code: 'request_failed' }))
        response = json({ error: 'temporarily_unavailable' }, 503)
      }
    }
    // Assetsから返るResponseのheadersは変更不可。複製して共通ヘッダーを付ける。
    response = new Response(response.body, response)
    response.headers.set('Cache-Control', 'no-store')
    if (new URL(request.url).pathname.startsWith('/setup/')) response.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
    response.headers.set('Referrer-Policy', 'no-referrer')
    response.headers.set('X-Content-Type-Options', 'nosniff')
    if (new URL(request.url).protocol === 'https:') response.headers.set('Strict-Transport-Security', 'max-age=31536000')
    response.headers.set('Vary', 'Origin')
    if (origin) {
      response.headers.set('Access-Control-Allow-Origin', origin)
      response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
      response.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, If-Match, If-None-Match, X-Katazuku-Source')
      response.headers.set('Access-Control-Expose-Headers', 'ETag, Retry-After')
      response.headers.set('Access-Control-Max-Age', '600')
    }
    return response
  },
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> { await collectExpired(env) },
} satisfies ExportedHandler<Env>
