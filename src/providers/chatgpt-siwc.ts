/**
 * chatgpt-siwc: 「Sign in with ChatGPT」で本人が許可した ChatGPT プランを、
 * このPC上で動くオープンソースアプリ(katazuku)の推論に使う provider。
 *
 * 公式手順: https://developers.openai.com/siwc/token-sharing-open-source
 *   (sign-in / profiles-and-sessions / models-and-inference / token-reference / errors-and-recovery / preview-limitations)
 * に従って実装している。要点:
 * - 初回は client_id=dynamic_agent_client で動的登録し、コールバックで返る発行済み client_id を保存して以後使う。
 * - ホストごとに安定した ext_agent_host_id(urn:uuid:<v4>)を、初回サインイン前に作って保存し続ける。
 * - PKCE(S256)・state・nonce は試行ごとに新しく作る。コールバックは 127.0.0.1 のループバック(/auth/callback)。
 * - ID トークンは公開 JWKS で署名(RS256)・issuer・audience(=発行済み client_id)・期限・nonce を検証する。
 * - 付与スコープに chatgpt.tokens.use.direct が無ければプラン利用は無効として推論しない。
 * - 推論は POST https://api.openai.com/v1/responses を store:false / stream:true で呼び、response.completed で完了とする。
 * - 資格情報はリポジトリの外(既定 ~/.config/katazuku/chatgpt/)に、所有者のみ読める権限で原子的に書く。
 *   ログ・URL・コミットには載せない。
 *
 * 開発者でない利用者にとって一番かんたんな経路なので既定で有効(サインインしていなければ preflight で飛ばされる)。
 * OpenAI 側の提供はプレビュー段階。止めたい場合は KATAZUKU_DISABLE_CHATGPT_SIWC=1。
 * 利用者のトークンを中継するホスト型サーバは作らない(ローカルで完結させる。ホスト型は OpenAI の別手続きが要る)。
 */
import { createHash, createPublicKey, randomBytes, randomUUID, verify as verifySignature } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentAdapter, ProcessResult } from '../agent-runtime.js'
import { toProcessResult } from './http.js'
import { callResponses, OPENAI_API_BASE } from './openai-responses.js'

export const SIWC_ISSUER = 'https://auth.openai.com'
export const SIWC_DISCOVERY_URL = `${SIWC_ISSUER}/.well-known/openid-configuration`
export const SIWC_RESOURCE = 'https://api.openai.com/v1'
export const SIWC_SCOPES = ['openid', 'profile', 'email', 'offline_access', 'resource.invoke', 'chatgpt.tokens.use.direct']
export const PLAN_USAGE_SCOPE = 'chatgpt.tokens.use.direct'
export const DYNAMIC_CLIENT_ID = 'dynamic_agent_client'
/** 登録時に表示される agent 名。どのインストールでも同じ実名を使う(表示用メタデータで、身元ではない) */
export const AGENT_NAME_HINT = 'katazuku'
export const CALLBACK_PATH = '/auth/callback'
export const DEFAULT_CALLBACK_PORT = 1455

export interface Discovery {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  revocation_endpoint: string
  jwks_uri: string
}

/** 公式の発見文書が取れないときの値(ドキュメント記載の本番値)。issuer の一致は必ず発見文書側で確かめる */
const FALLBACK_DISCOVERY: Discovery = {
  issuer: SIWC_ISSUER,
  authorization_endpoint: `${SIWC_ISSUER}/api/accounts/authorize`,
  token_endpoint: `${SIWC_ISSUER}/api/accounts/oauth/token`,
  revocation_endpoint: `${SIWC_ISSUER}/api/accounts/oauth/revoke`,
  jwks_uri: `${SIWC_ISSUER}/.well-known/jwks.json`,
}

export async function discover(request: typeof fetch = fetch): Promise<Discovery> {
  try {
    const response = await request(SIWC_DISCOVERY_URL, { signal: AbortSignal.timeout(15_000) })
    if (!response.ok) return FALLBACK_DISCOVERY
    const doc = await response.json() as Partial<Discovery>
    if (doc.issuer !== SIWC_ISSUER || !doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) return FALLBACK_DISCOVERY
    return { ...FALLBACK_DISCOVERY, ...doc } as Discovery
  } catch {
    return FALLBACK_DISCOVERY
  }
}

// ---------------------------------------------------------------- 保存(リポジトリの外・所有者のみ)

export function credentialsDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.KATAZUKU_CHATGPT_DIR?.trim()) return env.KATAZUKU_CHATGPT_DIR.trim()
  if (process.platform === 'win32' && env.APPDATA) return join(env.APPDATA, 'katazuku', 'chatgpt')
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'katazuku', 'chatgpt')
}

/**
 * 原子的に書く(一時ファイル → rename)。POSIX では 0600。Windows ではユーザープロファイル配下
 * (%APPDATA%)の既定ACLが本人のみなので、その場所に置くことで同等にする。
 */
export function writeSecretFile(path: string, value: unknown): void {
  const dir = join(path, '..')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  if (process.platform !== 'win32') chmodSync(temp, 0o600)
  renameSync(temp, path)
}

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return undefined
  }
}

/**
 * このホストの ext_agent_host_id。初回サインイン前に作って保存し、以後同じ値を使い続ける。
 * メールやユーザーIDなど個人を特定できる値は使わない(UUIDv4 を urn:uuid: で包む)。
 * 資格情報ファイルとは別ファイルにしてあるので、別ホストへ資格情報を移しても上書きされない。
 */
export function getOrCreateHostId(dir: string): string {
  const path = join(dir, 'host.json')
  const existing = readJson<{ ext_agent_host_id?: string }>(path)?.ext_agent_host_id
  if (existing && /^urn:uuid:[0-9a-f-]{36}$/.test(existing)) return existing
  const hostId = `urn:uuid:${randomUUID()}`
  writeSecretFile(path, { ext_agent_host_id: hostId, created_at: new Date().toISOString() })
  return hostId
}

export interface CredentialRecord {
  /** 利用者が区別するための安定したラベル(同じメールでも登録ごとに別) */
  label: string
  email: string
  issuer: string
  subject: string
  client_id: string
  ext_agent_host_id: string
  id_token?: string
  access_token?: string
  refresh_token?: string
  token_type?: string
  expires_in?: number
  earliest_refresh_at?: number
  scopes: string[]
  saved_at: string
  /** chatgpt.tokens.use.direct が付与されたか */
  plan_usage_enabled: boolean
  /** 初回の「ChatGPT プランを使っています」案内を出したか */
  welcomed?: boolean
  /** 推論に使うモデル(slug)。未設定なら /v1/models の先頭 */
  model?: string
}

function accountPath(dir: string, label: string): string {
  if (!/^[a-z0-9-]{1,40}$/.test(label)) throw new Error('ラベルは英小文字・数字・ハイフンの40字以内にしてください')
  return join(dir, 'accounts', `${label}.json`)
}

export function saveCredential(dir: string, record: CredentialRecord): void {
  writeSecretFile(accountPath(dir, record.label), record)
}

export function loadCredential(dir: string, label: string): CredentialRecord | undefined {
  return readJson<CredentialRecord>(accountPath(dir, label))
}

export function listCredentials(dir: string): CredentialRecord[] {
  const accounts = join(dir, 'accounts')
  if (!existsSync(accounts)) return []
  return readdirSync(accounts).filter((file) => file.endsWith('.json'))
    .map((file) => readJson<CredentialRecord>(join(accounts, file)))
    .filter((record): record is CredentialRecord => Boolean(record))
}

export function activeLabel(dir: string): string | undefined {
  return readJson<{ label?: string }>(join(dir, 'active.json'))?.label
}

export function setActiveLabel(dir: string, label: string): void {
  writeSecretFile(join(dir, 'active.json'), { label })
}

// ---------------------------------------------------------------- OAuth(PKCE・ループバック)

export function base64url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32))
  return { verifier, challenge: base64url(createHash('sha256').update(verifier).digest()) }
}

export interface AuthorizationAttempt {
  state: string
  nonce: string
  verifier: string
  redirectUri: string
  /** 再認可なら保存済みの発行済み client_id。新規登録なら undefined */
  clientId?: string
  url: string
}

export function redirectUriFor(port: number): string {
  // localhost ではなく 127.0.0.1。変えてよいのはポートだけ(スキーム・ホスト・パスは固定)
  return `http://127.0.0.1:${port}${CALLBACK_PATH}`
}

export function buildAuthorizationAttempt(options: {
  discovery: Discovery
  hostId: string
  port: number
  existing?: Pick<CredentialRecord, 'client_id' | 'id_token' | 'email'>
  /**
   * 一度断った ChatGPT プラン利用を、本人が設定から明示的に有効化するときだけ true。
   * 通常のサインインで毎回同意を強制しない。force_reconsent は OpenAI の展開確認後に切り替える(TODO)。
   */
  requestConsent?: boolean
}): AuthorizationAttempt {
  const pkce = createPkce()
  const state = base64url(randomBytes(24))
  const nonce = base64url(randomBytes(24))
  const redirectUri = redirectUriFor(options.port)
  const params = new URLSearchParams()
  const clientId = options.existing?.client_id
  params.set('client_id', clientId ?? DYNAMIC_CLIENT_ID)
  // agent_name_hint は初回の動的登録だけに付ける(再認可では送らない)
  if (!clientId) params.set('agent_name_hint', AGENT_NAME_HINT)
  params.set('ext_agent_host_id', options.hostId)
  if (clientId && options.existing?.id_token) params.set('id_token_hint', options.existing.id_token)
  if (clientId && options.existing?.email) params.set('login_hint', options.existing.email)
  params.set('response_type', 'code')
  params.set('redirect_uri', redirectUri)
  params.set('scope', SIWC_SCOPES.join(' '))
  params.set('resource', SIWC_RESOURCE)
  params.set('state', state)
  params.set('nonce', nonce)
  params.set('code_challenge_method', 'S256')
  params.set('code_challenge', pkce.challenge)
  if (options.requestConsent) params.set('prompt', 'consent')
  return { state, nonce, verifier: pkce.verifier, redirectUri, clientId, url: `${options.discovery.authorization_endpoint}?${params}` }
}

/** ログや画面に出す用。id_token_hint を含むURLはそのまま出さない */
export function redactAuthorizationUrl(url: string): string {
  return url.replace(/([?&]id_token_hint=)[^&]+/, '$1[REDACTED]')
}

export interface CallbackResult {
  code: string
  clientId: string
  scope?: string
}

/**
 * コールバックの検証。state を必ず先に照合し、拒否(access_denied)なら交換しない。
 * 新規登録で発行済み client_id が返らなければ登録未完了。再認可で別の client_id が返ったら拒否する。
 */
export function validateCallback(query: URLSearchParams, attempt: AuthorizationAttempt): CallbackResult {
  if (query.get('state') !== attempt.state) throw new Error('state が一致しません(別の試行の応答か、改ざんの可能性)')
  const error = query.get('error')
  if (error === 'access_denied') throw new Error('ChatGPT での許可が拒否されました。ChatGPT プラン利用は無効のままです')
  if (error) throw new Error(`認可エラー: ${error}`)
  const code = query.get('code')
  if (!code) throw new Error('認可コードがありません')
  const returned = query.get('client_id') ?? undefined
  if (!attempt.clientId) {
    if (!returned || returned === DYNAMIC_CLIENT_ID) throw new Error('発行済み client_id が返らなかったため、登録は未完了です')
    return { code, clientId: returned, scope: query.get('scope') ?? undefined }
  }
  if (returned && returned !== attempt.clientId) throw new Error('保存済みの client_id と異なる client_id が返りました。登録を置き換えずに中止します')
  return { code, clientId: attempt.clientId, scope: query.get('scope') ?? undefined }
}

/** 127.0.0.1 でコールバックを1回だけ受ける。ブラウザを開く前に待ち受けを始める */
export async function startLoopback(preferredPort: number = DEFAULT_CALLBACK_PORT): Promise<{ port: number; wait: (timeoutMs: number) => Promise<URLSearchParams>; close: () => void }> {
  let resolveQuery: (query: URLSearchParams) => void = () => {}
  const received = new Promise<URLSearchParams>((resolve) => { resolveQuery = resolve })
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== CALLBACK_PATH) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<!doctype html><meta charset="utf-8"><title>katazuku</title><p>サインインの結果を受け取りました。このタブを閉じてターミナルへ戻ってください。</p>')
    resolveQuery(url.searchParams)
  })
  const listen = (port: number) => new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve((server.address() as { port: number }).port))
  })
  let port: number
  try {
    port = await listen(preferredPort)
  } catch {
    // 既定ポートが使用中なら空きポートで(ドキュメント上、ポートだけは変えてよい)
    port = await listen(0)
  }
  return {
    port,
    wait: (timeoutMs) => Promise.race([
      received,
      new Promise<URLSearchParams>((_, reject) => setTimeout(() => reject(new Error('サインインの待ち時間を超えました')), timeoutMs).unref()),
    ]),
    close: () => server.close(),
  }
}

export interface TokenResponse {
  access_token: string
  refresh_token?: string
  id_token?: string
  token_type?: string
  expires_in?: number
  scope?: string
  earliest_refresh_at?: number
}

async function postForm(url: string, form: Record<string, string>, request: typeof fetch): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await response.text()
  let json: Record<string, unknown> = {}
  try { json = text ? JSON.parse(text) as Record<string, unknown> : {} } catch { json = {} }
  return { status: response.status, json }
}

function oauthErrorCode(json: Record<string, unknown>): string {
  const error = json.error
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string') return (error as { code: string }).code
  return typeof json.code === 'string' ? json.code : ''
}

/** 認可コードを交換する(クライアントシークレット不要。同じ redirect_uri と resource を送る) */
export async function exchangeCode(discovery: Discovery, attempt: AuthorizationAttempt, callback: CallbackResult, request: typeof fetch = fetch): Promise<TokenResponse> {
  const { status, json } = await postForm(discovery.token_endpoint, {
    grant_type: 'authorization_code',
    client_id: callback.clientId,
    code: callback.code,
    code_verifier: attempt.verifier,
    redirect_uri: attempt.redirectUri,
    resource: SIWC_RESOURCE,
  }, request)
  if (status !== 200 || typeof json.access_token !== 'string') {
    const code = oauthErrorCode(json)
    if (code === 'invalid_grant') throw new Error('認可コードが無効です(invalid_grant)。最初からサインインし直してください')
    throw new Error(`トークン交換に失敗しました(HTTP ${status}${code ? ` ${code}` : ''})`)
  }
  return json as unknown as TokenResponse
}

// ---------------------------------------------------------------- IDトークンの検証(依存ゼロ・RS256)

interface Jwk { kid?: string; kty: string; n?: string; e?: string; alg?: string; use?: string }

function decodeSegment<T>(segment: string): T {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as T
}

export interface IdTokenClaims {
  iss: string
  sub: string
  aud: string | string[]
  exp: number
  iat?: number
  nonce?: string
  email?: string
}

/**
 * 署名を公開 JWKS で検証し、issuer・audience(発行済み client_id)・期限・nonce を確かめる。
 * 知らない kid が来たら JWKS を取り直す(鍵のローテーション)。時計のずれは5秒まで許す。
 */
export async function verifyIdToken(
  idToken: string,
  options: { discovery: Discovery; clientId: string; nonce: string; now?: Date; fetch?: typeof fetch; jwks?: Jwk[] },
): Promise<IdTokenClaims> {
  const [headerPart, payloadPart, signaturePart] = idToken.split('.')
  if (!headerPart || !payloadPart || !signaturePart) throw new Error('IDトークンの形式が不正です')
  const header = decodeSegment<{ alg?: string; kid?: string }>(headerPart)
  if (header.alg !== 'RS256') throw new Error(`IDトークンの署名方式が想定外です: ${header.alg}`)
  const loadKeys = async (): Promise<Jwk[]> => {
    const response = await (options.fetch ?? fetch)(options.discovery.jwks_uri, { signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error('JWKS を取得できません')
    return ((await response.json()) as { keys?: Jwk[] }).keys ?? []
  }
  let keys = options.jwks ?? await loadKeys()
  let jwk = keys.find((key) => key.kid === header.kid)
  if (!jwk && !options.jwks) {
    keys = await loadKeys()
    jwk = keys.find((key) => key.kid === header.kid)
  }
  if (!jwk || jwk.kty !== 'RSA') throw new Error('IDトークンの署名鍵が見つかりません')
  const key = createPublicKey({ key: jwk as never, format: 'jwk' })
  const valid = verifySignature('RSA-SHA256', Buffer.from(`${headerPart}.${payloadPart}`), key, Buffer.from(signaturePart, 'base64url'))
  if (!valid) throw new Error('IDトークンの署名が一致しません')
  const claims = decodeSegment<IdTokenClaims>(payloadPart)
  const nowSec = Math.floor((options.now ?? new Date()).getTime() / 1000)
  if (claims.iss !== options.discovery.issuer) throw new Error('IDトークンの issuer が一致しません')
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (!audiences.includes(options.clientId)) throw new Error('IDトークンの audience が発行済み client_id と一致しません')
  if (typeof claims.exp !== 'number' || claims.exp + 5 < nowSec) throw new Error('IDトークンの期限が切れています')
  if (claims.nonce !== options.nonce) throw new Error('IDトークンの nonce が一致しません')
  if (typeof claims.sub !== 'string' || !claims.sub) throw new Error('IDトークンに subject がありません')
  return claims
}

export function grantedScopes(token: TokenResponse, callbackScope?: string): string[] {
  // 判断は token 応答の scope を正とする(コールバックの scope は参考)
  return (token.scope ?? callbackScope ?? '').split(/\s+/).filter(Boolean).sort()
}

/** 検証済みの交換結果から保存レコードを作る。既存の登録と身元(sub)が違えば置き換えない */
export function buildCredentialRecord(options: {
  label: string
  token: TokenResponse
  claims: IdTokenClaims
  clientId: string
  hostId: string
  callbackScope?: string
  existing?: CredentialRecord
  now?: Date
}): CredentialRecord {
  if (options.existing && options.existing.subject !== options.claims.sub) {
    throw new Error('選んだアカウントと別の ChatGPT アカウントでサインインされました。既存の登録を置き換えずに中止します')
  }
  const scopes = grantedScopes(options.token, options.callbackScope)
  return {
    label: options.label,
    email: options.claims.email ?? options.existing?.email ?? '',
    issuer: options.claims.iss,
    subject: options.claims.sub,
    client_id: options.clientId,
    ext_agent_host_id: options.hostId,
    id_token: options.token.id_token,
    access_token: options.token.access_token,
    refresh_token: options.token.refresh_token,
    token_type: options.token.token_type ?? 'Bearer',
    expires_in: options.token.expires_in,
    earliest_refresh_at: options.token.earliest_refresh_at,
    scopes,
    saved_at: (options.now ?? new Date()).toISOString(),
    plan_usage_enabled: scopes.includes(PLAN_USAGE_SCOPE),
    welcomed: options.existing?.welcomed,
    model: options.existing?.model,
  }
}

// ---------------------------------------------------------------- 更新・失効

const TERMINAL_REFRESH_ERRORS = new Set([
  'invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused',
])

export function needsRefresh(record: CredentialRecord, now: Date = new Date()): boolean {
  if (!record.access_token) return true
  const saved = Date.parse(record.saved_at)
  const expiresAt = saved + (record.expires_in ?? 3600) * 1000
  return now.getTime() > expiresAt - 5 * 60_000
}

/** 同じセッションの更新を直列化する(回転する refresh_token を2プロセスで取り合わない) */
async function withRefreshLock<T>(dir: string, label: string, action: () => Promise<T>): Promise<T> {
  const lock = join(dir, 'accounts', `${label}.refresh.lock`)
  mkdirSync(join(dir, 'accounts'), { recursive: true })
  const deadline = Date.now() + 30_000
  while (true) {
    try {
      writeFileSync(lock, String(process.pid), { flag: 'wx' })
      break
    } catch {
      try { if (Date.now() - statSync(lock).mtimeMs > 60_000) rmSync(lock, { force: true }) } catch { /* 消えていれば次へ */ }
      if (Date.now() > deadline) throw new Error('別のプロセスがトークンを更新中です')
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  try {
    return await action()
  } finally {
    rmSync(lock, { force: true })
  }
}

export class SignInRequiredError extends Error {}

/**
 * 期限が近ければ更新する。成功したら access_token・期限・スコープ・回転後の refresh_token をまとめて置き換える。
 * 使えない refresh_token(invalid_grant 等)なら、その資格情報を消して再サインインを求める。
 * 一時的な失敗(通信・5xx)では資格情報を消さない。
 */
export async function ensureFreshCredential(dir: string, label: string, options: { fetch?: typeof fetch; now?: Date; discovery?: Discovery } = {}): Promise<CredentialRecord> {
  const current = loadCredential(dir, label)
  if (!current || !current.refresh_token) throw new SignInRequiredError('ChatGPT にサインインしていません(npm run chatgpt -- signin)')
  if (!needsRefresh(current, options.now)) return current
  return withRefreshLock(dir, label, async () => {
    const latest = loadCredential(dir, label) ?? current
    if (!needsRefresh(latest, options.now)) return latest
    const discovery = options.discovery ?? await discover(options.fetch)
    const { status, json } = await postForm(discovery.token_endpoint, {
      grant_type: 'refresh_token',
      client_id: latest.client_id,
      refresh_token: latest.refresh_token ?? '',
      resource: SIWC_RESOURCE,
    }, options.fetch ?? fetch)
    if (status === 200 && typeof json.access_token === 'string') {
      const token = json as unknown as TokenResponse
      const scopes = token.scope ? grantedScopes(token) : latest.scopes
      const next: CredentialRecord = {
        ...latest,
        access_token: token.access_token,
        refresh_token: token.refresh_token ?? latest.refresh_token,
        id_token: token.id_token ?? latest.id_token,
        expires_in: token.expires_in ?? latest.expires_in,
        earliest_refresh_at: token.earliest_refresh_at,
        scopes,
        plan_usage_enabled: scopes.includes(PLAN_USAGE_SCOPE),
        saved_at: (options.now ?? new Date()).toISOString(),
      }
      saveCredential(dir, next)
      return next
    }
    const code = oauthErrorCode(json)
    if (TERMINAL_REFRESH_ERRORS.has(code)) {
      saveCredential(dir, { ...latest, access_token: undefined, refresh_token: undefined })
      throw new SignInRequiredError(`ChatGPT のセッションが無効になりました(${code})。npm run chatgpt -- signin で再サインインしてください`)
    }
    if (code === 'invalid_client') throw new Error('client_id が無効です(invalid_client)。登録をやり直してください')
    throw new Error(`トークンの更新に一時的に失敗しました(HTTP ${status})`)
  })
}

/**
 * サインアウト。更新可能なセッションを失効させてから、そのアカウントのトークンを消す。
 * client_id とホストIDの対応は残す(次回のサインインで使う)。
 */
export async function signOut(dir: string, label: string, options: { fetch?: typeof fetch; discovery?: Discovery } = {}): Promise<{ revoked: boolean }> {
  const record = loadCredential(dir, label)
  if (!record) return { revoked: false }
  let revoked = false
  if (record.refresh_token) {
    const discovery = options.discovery ?? await discover(options.fetch)
    for (let attempt = 0; attempt < 3 && !revoked; attempt += 1) {
      try {
        const { status } = await postForm(discovery.revocation_endpoint, {
          token: record.refresh_token,
          token_type_hint: 'refresh_token',
          client_id: record.client_id,
        }, options.fetch ?? fetch)
        if (status === 200) revoked = true
        else if (status < 500) break
      } catch {
        // 通信失敗は少し待って再試行する
      }
      if (!revoked) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt))
    }
  }
  saveCredential(dir, { ...record, access_token: undefined, refresh_token: undefined, id_token: undefined })
  return { revoked }
}

// ---------------------------------------------------------------- モデル一覧と推論

export async function listModels(accessToken: string, request: typeof fetch = fetch): Promise<{ slug: string; display_name: string }[]> {
  const response = await request(`${OPENAI_API_BASE}/models`, { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`モデル一覧を取得できません(HTTP ${response.status})`)
  const json = await response.json() as { models?: { slug?: string; display_name?: string; visibility?: string }[] }
  return (json.models ?? [])
    .filter((model) => model.visibility === 'list' && model.slug)
    .map((model) => ({ slug: model.slug as string, display_name: model.display_name ?? model.slug as string }))
}

export interface ChatGptPlanOptions {
  env?: NodeJS.ProcessEnv
  fetch?: typeof fetch
}

export function isSiwcEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.KATAZUKU_DISABLE_CHATGPT_SIWC !== '1'
}

export function createChatGptPlanAdapter(options: ChatGptPlanOptions = {}): AgentAdapter {
  const env = options.env ?? process.env
  const dir = () => credentialsDir(env)
  let prepared: CredentialRecord | undefined
  return {
    id: 'chatgpt-siwc',
    capabilities: new Set<string>(),
    strictCapabilities: true,
    async preflight(request) {
      if (!isSiwcEnabled(env)) return { ok: false, failure: 'capability_missing', detail: 'KATAZUKU_DISABLE_CHATGPT_SIWC=1 で無効化されています' }
      const missing = request.capabilities.find((capability) => capability)
      if (missing) return { ok: false, failure: 'capability_missing', detail: `chatgpt-siwc はツールを持たないため ${missing} を使えません` }
      const label = activeLabel(dir())
      if (!label) return { ok: false, failure: 'auth_unavailable', detail: 'ChatGPT にサインインしていません(npm run chatgpt -- signin)' }
      try {
        prepared = await ensureFreshCredential(dir(), label, { fetch: options.fetch })
      } catch (error) {
        const failure = error instanceof SignInRequiredError ? 'auth_unavailable' : 'connection_failed'
        return { ok: false, failure, detail: (error as Error).message }
      }
      if (!prepared.plan_usage_enabled) {
        // 許可が無いまま推論しない。APIキーなど別の支払い経路を選ぶか、許可し直してもらう
        return { ok: false, failure: 'auth_unavailable', detail: 'ChatGPT プランの利用が許可されていません(npm run chatgpt -- signin --enable-plan)' }
      }
      return { ok: true }
    },
    buildInvocation(request) {
      return { command: `POST ${OPENAI_API_BASE}/responses`, args: ['store=false', 'stream=true', 'plan=chatgpt'], stdin: request.prompt, cwd: request.cwd }
    },
    async run(request, _paths, timeoutMs): Promise<ProcessResult> {
      const started = Date.now()
      const record = prepared ?? loadCredential(dir(), activeLabel(dir()) ?? '')
      if (!record?.access_token) return toProcessResult({ text: '', failure: 'auth_unavailable', diagnostic: 'アクセストークンがありません' }, started)
      let model = env.KATAZUKU_CHATGPT_MODEL?.trim() || record.model
      if (!model) {
        try {
          model = (await listModels(record.access_token, options.fetch))[0]?.slug
        } catch (error) {
          return toProcessResult({ text: '', failure: 'connection_failed', diagnostic: (error as Error).message }, started)
        }
      }
      if (!model) return toProcessResult({ text: '', failure: 'capability_missing', diagnostic: '使えるモデルが見つかりません' }, started)
      return toProcessResult(await callResponses({ token: record.access_token, model, prompt: request.prompt, timeoutMs, fetch: options.fetch }), started)
    },
    async readOutput(result) {
      return result.stdout
    },
    detectPossibleSideEffect() {
      return false
    },
  }
}
