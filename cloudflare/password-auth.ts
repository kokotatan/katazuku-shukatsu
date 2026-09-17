import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/** 個人用・OSS共通。保存先を所有するPCだけが初期設定／再設定を開始できる。 */
export interface PasswordEnv {
  PRIVATE_DATA: R2Bucket
  KATAZUKU_WRITE_SECRET: string
  KATAZUKU_READ_SECRET: string
  AUTH_LIMIT: { limit(options: { key: string }): Promise<{ success: boolean }> }
}
type PasswordRecord = { scheme: string; salt: string; hash: string; revision: string; deviceName: string; owner: string }
type Access = { origin: string; expires: number; owner: string; revision: string; deviceName?: string; passwordSalt?: string }
const CONFIG = 'auth-v2/password.json'
const COOKIE = '__Host-katazuku-session'
const TTL = 30 * 60
const hash = (s: string) => createHash('sha256').update(s).digest('hex')
const equal = (a: string, b: string) => timingSafeEqual(Buffer.from(hash(a), 'hex'), Buffer.from(hash(b), 'hex'))
const SCHEME = 'pbkdf2-sha256-600000-v1'
// 端末でPBKDF2を計算した後、保存先だけが持つ秘密でHMACをかける。
// 通信中のproofはパスワード相当の秘密。DBにはそのまま保存しない。
const proofHash = (env: PasswordEnv, proof: string, salt: string) => createHmac('sha256', env.KATAZUKU_WRITE_SECRET).update(SCHEME + '\0' + salt + '\0' + proof).digest('hex')
const reply = (body: unknown, status = 200, headers?: HeadersInit) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', ...headers } })
class AuthError extends Error { constructor(readonly status: number, message: string) { super(message) } }
const owner = (env: PasswordEnv) => hash(env.KATAZUKU_WRITE_SECRET)
const origin = (request: Request) => new URL(request.url).origin
const cookie = (value: string, age = TTL) => `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`
function sameOrigin(request: Request) {
  if (request.headers.get('origin') !== origin(request)) throw new AuthError(403, 'このアプリの画面から操作してください。')
}
async function body(request: Request) {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new AuthError(415, '送信形式が正しくありません。')
  if (!request.body) throw new AuthError(400, '入力を確認してください。')
  const reader = request.body.getReader(); let bytes = new Uint8Array(0)
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break
      if (bytes.length + next.value.length > 4096) { await reader.cancel(); throw new AuthError(413, '入力が長すぎます。') }
      const combined = new Uint8Array(bytes.length + next.value.length); combined.set(bytes); combined.set(next.value, bytes.length); bytes = combined
    }
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    return value as Record<string, unknown>
  } catch (e) { if (e instanceof AuthError) throw e; throw new AuthError(400, '入力を確認してください。') }
  finally { reader.releaseLock() }
}
async function configuration(env: PasswordEnv) {
  const object = await env.PRIVATE_DATA.get(CONFIG)
  if (!object) return null
  const value = await object.json<PasswordRecord>()
  if (!value || !/^[a-f0-9]{64}$/.test(value.hash) || !/^[a-f0-9]{32}$/.test(value.salt) || !value.revision) throw new AuthError(503, 'PCから設定を確認してください。')
  return { value, etag: object.etag }
}
export async function passwordConfigured(env: PasswordEnv) { return Boolean(await configuration(env)) }
function accessKey(kind: 'setup' | 'session', token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new AuthError(401, '有効期限が切れています。PCからもう一度開いてください。')
  return `auth-v2/${kind}/${hash(token)}`
}
async function loadAccess(request: Request, env: PasswordEnv, kind: 'setup' | 'session', token: string) {
  const key = accessKey(kind, token); const object = await env.PRIVATE_DATA.get(key)
  if (!object) throw new AuthError(401, '有効期限が切れています。もう一度ログインしてください。')
  const record = await object.json<Access>()
  if (!record || record.origin !== origin(request) || record.expires <= Date.now() || !Number.isFinite(record.expires) || record.owner !== owner(env)) throw new AuthError(401, '有効期限が切れています。PCからもう一度開いてください。')
  return { key, record, etag: object.etag }
}
async function issue(request: Request, env: PasswordEnv, kind: 'setup' | 'session', revision: string, deviceName: string) {
  const token = randomBytes(32).toString('base64url')
  const expires = Date.now() + (kind === 'setup' ? 10 * 60 : TTL) * 1000
  const record: Access = { origin: origin(request), expires, owner: owner(env), revision, deviceName, ...(kind === 'setup' ? { passwordSalt: randomBytes(16).toString('hex') } : {}) }
  if (!await env.PRIVATE_DATA.put(accessKey(kind, token), JSON.stringify(record), { onlyIf: { etagDoesNotMatch: '*' } })) throw new AuthError(503, 'もう一度お試しください。')
  return { token, expires }
}
function sessionToken(request: Request) { return request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || '' }
export async function passwordSession(request: Request, env: PasswordEnv): Promise<boolean> {
  const token = sessionToken(request); if (!token) return false
  try {
    const access = await loadAccess(request, env, 'session', token)
    const config = await configuration(env)
    return access.record.revision === (config?.value.revision || 'legacy') && (!config || config.value.owner === owner(env))
  } catch (e) { if (e instanceof AuthError && e.status === 401) return false; throw e }
}
export async function authenticatePasswordProof(env: PasswordEnv, proof: unknown): Promise<PasswordRecord | null> {
  if (typeof proof !== 'string' || !/^[a-f0-9]{64}$/.test(proof)) return null
  const config = await configuration(env)
  if (!config || config.value.scheme !== SCHEME || config.value.owner !== owner(env)) return null
  return equal(proofHash(env, proof, config.value.salt), config.value.hash) ? config.value : null
}
export async function passwordRevision(env: PasswordEnv) { return (await configuration(env))?.value.revision || 'legacy' }

export async function passwordAuth(request: Request, env: PasswordEnv): Promise<Response | null> {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/api/auth/')) return null
  try {
    if (url.search) throw new AuthError(400, 'URLに認証情報を含めないでください。')
    if (!env.KATAZUKU_WRITE_SECRET || !env.KATAZUKU_READ_SECRET) throw new AuthError(503, 'このPCで初回設定を行ってください。')
    if (url.pathname === '/api/auth/status' && request.method === 'GET') {
      const authenticated = await passwordSession(request, env)
      const config = await configuration(env)
      return reply({ configured: Boolean(config), authenticated, ...(authenticated ? { deviceName: config?.value.deviceName || '自分のPC' } : {}) })
    }
    if (url.pathname === '/api/auth/challenge' && request.method === 'GET') {
      const config = await configuration(env)
      if (!config || config.value.scheme !== SCHEME) throw new AuthError(409, 'PCからパスワードを設定してください。')
      return reply({ scheme: SCHEME, salt: config.value.salt })
    }
    if (request.method !== 'POST') throw new AuthError(405, 'この操作には対応していません。')
    // 所有者のPCは長期キーをサーバー間通信だけに使用する。
    if (url.pathname === '/api/auth/setup-link') {
      if (!equal(request.headers.get('authorization') || '', `Bearer ${env.KATAZUKU_WRITE_SECRET}`)) throw new AuthError(401, '所有者のPCから初回設定を始めてください。')
      const input = await body(request)
      if (typeof input.deviceName !== 'string' || !input.deviceName.trim() || input.deviceName.length > 80) throw new AuthError(400, 'PCの名前を入力してください。')
      const config = await configuration(env)
      const access = await issue(request, env, 'setup', config?.value.revision || '', input.deviceName.trim())
      return reply({ setupToken: access.token, expiresAt: access.expires, configured: Boolean(config) })
    }
    sameOrigin(request)
    if (url.pathname === '/api/auth/logout') {
      const token = sessionToken(request)
      if (/^[A-Za-z0-9_-]{43}$/.test(token)) await env.PRIVATE_DATA.delete(accessKey('session', token))
      return reply({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) })
    }
    if (!env.AUTH_LIMIT || !(await env.AUTH_LIMIT.limit({ key: hash(origin(request) + '\0' + (request.headers.get('cf-connecting-ip') || 'local')) })).success) throw new AuthError(429, '操作が続いています。1分ほど待ってからお試しください。')
    const input = await body(request)
    if (url.pathname === '/api/auth/inspect-setup') {
      const access = await loadAccess(request, env, 'setup', String(input.setupToken || ''))
      const config = await configuration(env)
      if (access.record.revision !== (config?.value.revision || '')) throw new AuthError(409, '設定が変更されました。PCからもう一度開いてください。')
      if (!access.record.passwordSalt) throw new AuthError(409, 'PCから設定画面を開き直してください。')
      return reply({ deviceName: access.record.deviceName, configured: Boolean(config), scheme: SCHEME, salt: access.record.passwordSalt })
    }
    if (url.pathname === '/api/auth/setup') {
      if (typeof input.passwordProof !== 'string' || !/^[a-f0-9]{64}$/.test(input.passwordProof) || 'password' in input) throw new AuthError(400, 'パスワードの設定画面からやり直してください。')
      const access = await loadAccess(request, env, 'setup', String(input.setupToken || ''))
      const previous = await configuration(env)
      if (access.record.revision !== (previous?.value.revision || '')) throw new AuthError(409, '設定が変更されました。PCからもう一度開いてください。')
      const salt = access.record.passwordSalt
      if (!salt) throw new AuthError(409, 'PCから設定画面を開き直してください。')
      const config: PasswordRecord = { scheme: SCHEME, salt, hash: proofHash(env, input.passwordProof, salt), revision: randomBytes(16).toString('hex'), deviceName: access.record.deviceName || '自分のPC', owner: owner(env) }
      // 同時利用と二重登録を、R2の条件付き書き込みで拒否する。
      if (!await env.PRIVATE_DATA.put(access.key, JSON.stringify({ consumed: true }), { onlyIf: { etagMatches: access.etag } })) throw new AuthError(409, 'この設定画面は使用済みです。PCからもう一度開いてください。')
      if (!await env.PRIVATE_DATA.put(CONFIG, JSON.stringify(config), { onlyIf: previous ? { etagMatches: previous.etag } : { etagDoesNotMatch: '*' } })) throw new AuthError(409, '設定が変更されました。PCからもう一度開いてください。')
      const session = await issue(request, env, 'session', config.revision, config.deviceName)
      return reply({ ok: true, expiresAt: session.expires }, 200, { 'Set-Cookie': cookie(session.token) })
    }
    if (url.pathname === '/api/auth/login') {
      if ('password' in input) throw new AuthError(400, 'ログイン画面を再読み込みしてください。')
      const config = await authenticatePasswordProof(env, input.passwordProof)
      if (!config) throw new AuthError(401, 'パスワードが違います。入力内容を確認してください。')
      const session = await issue(request, env, 'session', config.revision, config.deviceName)
      return reply({ ok: true, expiresAt: session.expires }, 200, { 'Set-Cookie': cookie(session.token) })
    }
    if (url.pathname === '/api/auth/migrate') {
      if (await passwordConfigured(env) || typeof input.readKey !== 'string' || !equal(input.readKey, env.KATAZUKU_READ_SECRET)) throw new AuthError(401, 'PCから初回設定を行ってください。')
      const session = await issue(request, env, 'session', 'legacy', '自分のPC')
      return reply({ ok: true }, 200, { 'Set-Cookie': cookie(session.token) })
    }
    throw new AuthError(404, '操作が見つかりません。')
  } catch (e) {
    return reply({ error: e instanceof AuthError ? e.message : '接続できませんでした。もう一度お試しください。' }, e instanceof AuthError ? e.status : 503)
  }
}
