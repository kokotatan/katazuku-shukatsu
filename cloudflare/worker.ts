import { timingSafeEqual } from 'node:crypto'

const SNAPSHOT_KEY = 'snapshot.json'
const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024
const MIN_SECRET_BYTES = 32
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', ...CORS_HEADERS, ...headers },
  })
}

function requiredSecret(value: string | undefined, name: string): string {
  if (!value || new TextEncoder().encode(value).byteLength < MIN_SECRET_BYTES) {
    throw new HttpError(503, `${name} is not configured`)
  }
  return value
}

function readSecret(env: Env): string {
  const read = requiredSecret(env.KATAZUKU_READ_SECRET, 'read secret')
  const write = requiredSecret(env.KATAZUKU_WRITE_SECRET, 'write secret')
  // これは利用者入力との照合ではなく、設定ミスをfail-closedにする検査。
  if (read === write) throw new HttpError(503, 'read and write secrets must differ')
  return read
}

function writeSecret(env: Env): string {
  readSecret(env)
  return requiredSecret(env.KATAZUKU_WRITE_SECRET, 'write secret')
}

async function secretMatches(provided: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ])
  return timingSafeEqual(new Uint8Array(providedHash), new Uint8Array(expectedHash))
}

async function requireReadAccess(request: Request, env: Env, url: URL): Promise<void> {
  const bearer = request.headers.get('Authorization') ?? ''
  const queryKey = url.searchParams.get('key') ?? ''
  const expected = readSecret(env)
  if (
    !await secretMatches(bearer, `Bearer ${expected}`)
    && !await secretMatches(queryKey, expected)
  ) {
    throw new HttpError(401, 'unauthorized')
  }
}

async function requireWriteAccess(request: Request, env: Env): Promise<void> {
  const bearer = request.headers.get('Authorization') ?? ''
  if (!await secretMatches(bearer, `Bearer ${writeSecret(env)}`)) {
    throw new HttpError(401, 'unauthorized')
  }
}

async function handleData(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== 'GET') throw new HttpError(405, 'GET only')
  await requireReadAccess(request, env, url)
  const object = await env.PRIVATE_DATA.get(SNAPSHOT_KEY)
  if (!object) return json({ error: 'snapshot not found' }, 404)
  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType || 'application/json',
      'Cache-Control': 'no-store',
      ...CORS_HEADERS,
      ETag: object.httpEtag,
    },
  })
}

async function handlePush(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'PUT') throw new HttpError(405, 'PUT only')
  await requireWriteAccess(request, env)
  const contentLength = Number(request.headers.get('Content-Length'))
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0) {
    throw new HttpError(411, 'Content-Length required')
  }
  if (contentLength > MAX_SNAPSHOT_BYTES) throw new HttpError(413, 'snapshot too large')
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'application/json required')
  }
  if (!request.body) throw new HttpError(400, 'body required')
  let received = 0
  const limitedBody = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength
      if (received > MAX_SNAPSHOT_BYTES) throw new HttpError(413, 'snapshot too large')
      controller.enqueue(chunk)
    },
  }))
  const object = await env.PRIVATE_DATA.put(SNAPSHOT_KEY, limitedBody, {
    httpMetadata: { contentType: 'application/json' },
  })
  if (!object) throw new Error('R2 put returned null')
  return json({ ok: true, pathname: object.key, bytes: object.size })
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  if (request.method === 'OPTIONS' && (url.pathname === '/api/data' || url.pathname === '/api/push')) {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (url.pathname === '/health') return json({ ok: true })
  if (url.pathname === '/api/data') return await handleData(request, env, url)
  if (url.pathname === '/api/push') return await handlePush(request, env)
  return json({ error: 'not found' }, 404)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env)
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status)
      console.error(JSON.stringify({ level: 'error', message: 'request failed', error: String(error) }))
      return json({ error: 'internal error' }, 500)
    }
  },
} satisfies ExportedHandler<Env>
