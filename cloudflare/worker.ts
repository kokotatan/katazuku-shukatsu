import { Buffer } from 'node:buffer'
import { timingSafeEqual } from 'node:crypto'
import webpush from 'web-push'
import {
  getArticle,
  listArticles,
  parseFrontmatter,
  putArticle,
  setPublished,
  studioLinks,
} from './github'

const SNAPSHOT_KEY = 'snapshot.json'
const SUBSCRIPTIONS_KEY = 'push-subscriptions.json'
const PHOTO_PREFIX = 'private-photos/'
const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024
const MAX_PHOTO_REQUEST_BYTES = 3 * 1024 * 1024
const MAX_JSON_BYTES = 2 * 1024 * 1024

interface PushSubscriptionRecord {
  endpoint: string
  expirationTime?: number | null
  keys: { p256dh: string; auth: string }
  savedAt?: string
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      ...headers,
    },
  })
}

async function secretMatches(provided: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ])
  return timingSafeEqual(Buffer.from(providedHash), Buffer.from(expectedHash))
}

async function requireBearer(request: Request, expected: string): Promise<void> {
  const authorization = request.headers.get('Authorization') ?? ''
  if (!await secretMatches(authorization, `Bearer ${expected}`)) {
    throw new HttpError(401, 'unauthorized')
  }
}

async function requireQueryKey(url: URL, expected: string): Promise<void> {
  if (!await secretMatches(url.searchParams.get('key') ?? '', expected)) {
    throw new HttpError(401, 'unauthorized')
  }
}

function requireStudioEnv(env: Env): string {
  const studioSecret = optionalEnv(env, 'KATAZUKU_STUDIO_SECRET')
  if (!studioSecret || !optionalEnv(env, 'ZENN_GITHUB_TOKEN') || !optionalEnv(env, 'ZENN_REPO')) {
    throw new HttpError(503, 'studio is not configured')
  }
  return studioSecret
}

function optionalEnv(env: Env, name: string): string {
  const value = Reflect.get(env, name)
  return typeof value === 'string' ? value : ''
}

function requireMethod(request: Request, methods: string[]): void {
  if (!methods.includes(request.method)) {
    throw new HttpError(405, `${methods.join('/')} only`)
  }
}

function safeStorageKey(value: string): boolean {
  return /^[a-zA-Z0-9._/-]+$/.test(value) && !value.includes('..') && !value.startsWith('/')
}

async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
  if (!request.body) return {}
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel('body too large')
        throw new HttpError(413, 'payload too large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch {
    throw new HttpError(400, 'invalid JSON')
  }
}

async function loadSubscriptions(env: Env): Promise<PushSubscriptionRecord[]> {
  const object = await env.PRIVATE_DATA.get(SUBSCRIPTIONS_KEY)
  if (!object) return []
  const parsed: unknown = await object.json()
  return Array.isArray(parsed) ? parsed.filter(isSubscription) : []
}

async function saveSubscriptions(env: Env, subscriptions: PushSubscriptionRecord[]): Promise<void> {
  await env.PRIVATE_DATA.put(SUBSCRIPTIONS_KEY, JSON.stringify(subscriptions), {
    httpMetadata: { contentType: 'application/json' },
  })
}

async function handleData(request: Request, env: Env, url: URL): Promise<Response> {
  requireMethod(request, ['GET'])
  await requireQueryKey(url, env.KATAZUKU_READ_SECRET)
  const object = await env.PRIVATE_DATA.get(SNAPSHOT_KEY)
  if (!object) return json({ error: 'snapshot not found' }, 404, { 'Access-Control-Allow-Origin': '*' })
  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType || 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      ETag: object.httpEtag,
    },
  })
}

async function handlePush(request: Request, env: Env): Promise<Response> {
  requireMethod(request, ['PUT'])
  await requireBearer(request, env.KATAZUKU_WRITE_SECRET)
  const contentLength = Number(request.headers.get('Content-Length'))
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0) {
    throw new HttpError(411, 'Content-Length required')
  }
  if (contentLength > MAX_SNAPSHOT_BYTES) throw new HttpError(413, 'snapshot too large')
  if (!request.body) throw new HttpError(400, 'body required')
  const object = await env.PRIVATE_DATA.put(SNAPSHOT_KEY, request.body, {
    httpMetadata: { contentType: 'application/json' },
  })
  if (!object) throw new Error('R2 put returned null')
  return json({ ok: true, pathname: object.key, bytes: object.size })
}

async function handlePhoto(request: Request, env: Env, url: URL): Promise<Response> {
  requireMethod(request, ['GET'])
  await requireQueryKey(url, env.KATAZUKU_READ_SECRET)
  const id = url.searchParams.get('id') ?? ''
  if (!safeStorageKey(id)) throw new HttpError(400, 'invalid id')
  const object = await env.PRIVATE_DATA.get(`${PHOTO_PREFIX}${id}`)
  if (!object) return json({ error: 'not found' }, 404, { 'Access-Control-Allow-Origin': '*' })
  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'private, max-age=300',
      'Access-Control-Allow-Origin': '*',
      ETag: object.httpEtag,
    },
  })
}

async function handlePhotoPush(request: Request, env: Env): Promise<Response> {
  requireMethod(request, ['PUT'])
  await requireBearer(request, env.KATAZUKU_WRITE_SECRET)
  const body = await readBoundedJson(request, MAX_PHOTO_REQUEST_BYTES)
  if (!isPhotoPayload(body) || !safeStorageKey(body.storageKey)) {
    throw new HttpError(400, 'invalid payload')
  }
  const bytes = Buffer.from(body.contentBase64, 'base64')
  if (bytes.byteLength > 2 * 1024 * 1024) throw new HttpError(413, 'photo too large')
  const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])
  const contentType = allowedTypes.has(body.contentType ?? '') ? body.contentType! : 'image/jpeg'
  const object = await env.PRIVATE_DATA.put(`${PHOTO_PREFIX}${body.storageKey}`, bytes, {
    httpMetadata: { contentType },
  })
  if (!object) throw new Error('R2 put returned null')
  return json({ ok: true, pathname: object.key, bytes: object.size })
}

async function handlePushSubscribe(request: Request, env: Env, url: URL): Promise<Response> {
  requireMethod(request, ['POST'])
  await requireQueryKey(url, env.KATAZUKU_READ_SECRET)
  const body = await readBoundedJson(request, 64 * 1024)
  if (!isSubscription(body)) throw new HttpError(400, 'invalid subscription')
  const subscriptions = await loadSubscriptions(env)
  const next = subscriptions.filter((subscription) => subscription.endpoint !== body.endpoint)
  next.push({
    endpoint: body.endpoint,
    expirationTime: body.expirationTime ?? null,
    keys: { p256dh: body.keys.p256dh, auth: body.keys.auth },
    savedAt: new Date().toISOString(),
  })
  await saveSubscriptions(env, next)
  return json({ ok: true, count: next.length })
}

async function handlePushSend(request: Request, env: Env): Promise<Response> {
  requireMethod(request, ['POST'])
  await requireBearer(request, env.KATAZUKU_WRITE_SECRET)
  const value = await readBoundedJson(request, 64 * 1024)
  const body = isRecord(value) ? value : {}
  webpush.setVapidDetails(
    env.KATAZUKU_VAPID_SUBJECT,
    env.KATAZUKU_VAPID_PUBLIC_KEY,
    env.KATAZUKU_VAPID_PRIVATE_KEY,
  )
  const payload = JSON.stringify({
    title: typeof body.title === 'string' ? body.title : 'katazuku',
    body: typeof body.body === 'string' ? body.body : '',
    url: typeof body.url === 'string' ? body.url : '/insight/',
  })
  const subscriptions = await loadSubscriptions(env)
  if (subscriptions.length === 0) {
    return json({ ok: true, sent: 0, removed: 0, failed: 0, note: 'no subscriptions' })
  }
  let sent = 0
  const gone: string[] = []
  const failures: string[] = []
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: subscription.keys },
        payload,
        { TTL: 12 * 60 * 60 },
      )
      sent += 1
    } catch (error) {
      const statusCode = isRecord(error) && typeof error.statusCode === 'number' ? error.statusCode : undefined
      if (statusCode === 404 || statusCode === 410) gone.push(subscription.endpoint)
      else failures.push(String(statusCode ?? 'ERR'))
    }
  }
  if (gone.length > 0) {
    await saveSubscriptions(env, subscriptions.filter((subscription) => !gone.includes(subscription.endpoint)))
  }
  return json({ ok: true, sent, removed: gone.length, failed: failures.length, failures })
}

async function handleStudioLoad(request: Request, env: Env, url: URL): Promise<Response> {
  requireMethod(request, ['GET'])
  await requireQueryKey(url, requireStudioEnv(env))
  const slug = url.searchParams.get('slug') ?? ''
  if (slug) {
    const article = await getArticle(env, slug)
    if (!article) return json({ error: 'not found' }, 404)
    return json({ slug, md: article.md, meta: parseFrontmatter(article.md), ...studioLinks(env) })
  }
  return json({ articles: await listArticles(env), ...studioLinks(env) })
}

async function handleStudioSave(request: Request, env: Env): Promise<Response> {
  requireMethod(request, ['POST', 'PUT'])
  await requireBearer(request, requireStudioEnv(env))
  const value = await readBoundedJson(request, MAX_JSON_BYTES)
  if (!isRecord(value)) throw new HttpError(400, 'invalid JSON')
  const slug = typeof value.slug === 'string' ? value.slug : ''
  let md = typeof value.md === 'string' ? value.md : ''
  if (!/^[a-z0-9][a-z0-9_-]{0,49}$/.test(slug)) {
    throw new HttpError(400, 'slug は英小文字/数字/-/_ の1〜50文字')
  }
  if (!md.startsWith('---')) throw new HttpError(400, 'frontmatter(---) が必要です')
  if (typeof value.publish === 'boolean') md = setPublished(md, value.publish)
  const meta = parseFrontmatter(md)
  const existing = await getArticle(env, slug)
  if (existing?.md === md) {
    return json({ ok: true, unchanged: true, published: meta.published, ...studioLinks(env, meta.published ? slug : undefined) })
  }
  const action = meta.published ? '公開' : '下書き保存'
  const { commitUrl } = await putArticle(env, slug, md, `studio: ${action} ${slug}`)
  return json({ ok: true, published: meta.published, ...studioLinks(env, meta.published ? slug : undefined), commitUrl })
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  switch (url.pathname) {
    case '/api/data': return await handleData(request, env, url)
    case '/api/push': return await handlePush(request, env)
    case '/api/photo': return await handlePhoto(request, env, url)
    case '/api/photo-push': return await handlePhotoPush(request, env)
    case '/api/push-subscribe': return await handlePushSubscribe(request, env, url)
    case '/api/push-send': return await handlePushSend(request, env)
    case '/api/studio-load': return await handleStudioLoad(request, env, url)
    case '/api/studio-save': return await handleStudioSave(request, env)
    default:
      if (url.pathname.startsWith('/api/')) return json({ error: 'not found' }, 404)
      return await env.ASSETS.fetch(request)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSubscription(value: unknown): value is PushSubscriptionRecord {
  if (!isRecord(value) || typeof value.endpoint !== 'string' || !value.endpoint.startsWith('https://')) return false
  if (!isRecord(value.keys)) return false
  return typeof value.keys.p256dh === 'string' && typeof value.keys.auth === 'string'
}

function isPhotoPayload(value: unknown): value is { storageKey: string; contentBase64: string; contentType?: string } {
  return isRecord(value)
    && typeof value.storageKey === 'string'
    && typeof value.contentBase64 === 'string'
    && (value.contentType === undefined || typeof value.contentType === 'string')
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env)
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      const message = error instanceof HttpError ? error.message : 'internal server error'
      const log = JSON.stringify({
        message: 'request failed',
        method: request.method,
        path: new URL(request.url).pathname,
        status,
        error: error instanceof Error ? error.message : String(error),
      })
      if (status >= 500) console.error(log)
      else console.log(log)
      return json({ error: message }, status)
    }
  },
} satisfies ExportedHandler<Env>
