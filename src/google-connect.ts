/** 本人のデスクトップOAuthクライアントで読み取り専用接続を作る。秘密・個人値は出力しない。 */
import { execFileSync, spawn } from 'node:child_process'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, closeSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readdirSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { credentialPath, getGoogleAccessToken } from './google-auth.js'

export const GOOGLE_ISSUER = 'https://accounts.google.com'
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
export const GOOGLE_USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo'
export const GOOGLE_READ_SCOPES = [
  'openid', 'email',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
] as const
export const GOOGLE_READ_SUCCESS = 'Googleの本人確認とGmail・Calendarの読取りを確認しました。メール下書き・予定の書込みには別のMCP接続と本人の許可が必要です。第三者への送信は本人が行います。MCP・AI・定期実行の準備完了を意味しません。'

export class GoogleConnectError extends Error {}
function failure(message: string): never { throw new GoogleConnectError(message) }
const nonempty = (value: unknown): value is string => typeof value === 'string' && !!value.trim()
const sameEmail = (actual: unknown, expected: string): boolean => typeof actual === 'string' && actual.toLowerCase() === expected.toLowerCase()
const inside = (parent: string, child: string): boolean => {
  const path = relative(parent, child)
  return path !== '' && path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path)
}

export interface GoogleConnectOptions {
  email: string
  credentialsDir: string
  root: string
  clientId: string
  clientSecret: string
  /** 合成テスト用。CLIは既定のGoogle HTTPSエンドポイント以外を選べない。 */
  fetch?: typeof fetch
  openBrowser?: (url: string) => Promise<void>
  home?: string
  timeoutMs?: number
  signal?: AbortSignal
  protectFile?: (path: string) => void
}

/** 新しい空ファイルだけを保護する。既存の資格情報/ディレクトリの権限は変えない。 */
export function protectGoogleSecretFile(path: string, platform = process.platform, run = execFileSync): void {
  if (platform !== 'win32') { chmodSync(path, 0o600); return }
  const identity = run('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  // CSVの末尾のSID列だけを読む。EntraのS-1-12-1も受け入れ、表示名内の文字列は使わない。
  const sid = String(identity).trim().match(/,"(S-1-\d+(?:-\d+)+)"$/)?.[1]
  if (!sid) failure('本人だけの保存権限を設定できませんでした。資格情報は保存していません。')
  run('icacls.exe', [path, '/inheritance:r', '/grant:r', `*${sid}:(F)`], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
}

/** 別名のシンボリックリンクや既存のMCP資格情報も置換しない。 */
function existing(path: string): boolean {
  try { lstatSync(path); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function prepareStore(options: GoogleConnectOptions): string {
  // 現行MCPとkatazukuのファイル名が一致する表記だけを新規保存する。
  if (!/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(options.email)
    || /@(?:[^@]+\.)?example\.(?:com|net|org)$/i.test(options.email)) failure('自分のGoogleアカウントを個人設定に入力してください。')
  const home = realpathSync(options.home ?? homedir())
  const directory = resolve(options.credentialsDir)
  const root = realpathSync(options.root)
  if (!inside(home, directory) || directory === root || inside(root, directory)) failure('資格情報の保存先はリポジトリ外の本人のホーム配下にしてください。')
  // mkdirより先に既存の祖先を解決し、ホーム外へのリンクを通って作成しない。
  let ancestor = directory
  while (!existing(ancestor)) ancestor = resolve(ancestor, '..')
  const actualAncestor = realpathSync(ancestor)
  if (actualAncestor !== home && !inside(home, actualAncestor)) failure('資格情報の保存先のリンクがホーム外を指しています。')
  if (actualAncestor === root || inside(root, actualAncestor)) failure('資格情報はリポジトリ内に保存できません。')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const actualDirectory = realpathSync(directory)
  if (!inside(home, actualDirectory) || actualDirectory === root || inside(root, actualDirectory)) failure('資格情報の保存先が安全な場所ではありません。')
  if (process.platform !== 'win32' && (statSync(actualDirectory).mode & 0o077) !== 0) failure('保存先のディレクトリを本人だけがアクセスできる権限にしてください。既存の権限は変更していません。')
  const path = credentialPath(actualDirectory, options.email)
  if (existing(path) || readdirSync(actualDirectory).some(name => name.toLowerCase() === (options.email + '.json').toLowerCase())) {
    failure('既存のGoogle資格情報を保護するため接続を中止しました。読取り確認は --check、MCPの接続は docs/GOOGLE-CONNECTION.md を参照してください。')
  }
  return path
}

/** 本人のGoogle同意より先に、空ファイルだけで作成/ACL設定を検証する。 */
function probeStorePermissions(path: string, protect = protectGoogleSecretFile): void {
  const probe = join(resolve(path, '..'), '.oauth-probe-' + randomBytes(16).toString('hex') + '.tmp')
  const descriptor = openSync(probe, 'wx', 0o600)
  try { protect(probe) } finally { closeSync(descriptor); unlinkSync(probe) }
}

/** シェルを経由せずOSのブラウザを起動。URLはコンソールに出さない。 */
export async function openGoogleBrowser(url: string): Promise<void> {
  const [command, args] = process.platform === 'win32'
    ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]] as const
    : process.platform === 'darwin' ? ['open', [url]] as const : ['xdg-open', [url]] as const
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], { shell: false, windowsHide: true, stdio: 'ignore' })
    child.once('error', () => reject(new GoogleConnectError('ブラウザを開けませんでした。OSの既定ブラウザを確認してください。')))
    child.once('exit', code => code === 0 ? resolve() : reject(new GoogleConnectError('ブラウザを開けませんでした。OSの既定ブラウザを確認してください。')))
  })
}

async function authorizationCode(clientId: string, signal: AbortSignal, browser: (url: string) => Promise<void>): Promise<{ code: string; verifier: string; redirectUri: string }> {
  const state = randomBytes(32).toString('base64url')
  const verifier = randomBytes(32).toString('base64url')
  let redirectUri = ''
  let settle: ((value: string | GoogleConnectError) => void) | undefined
  const callback = new Promise<string>((resolve, reject) => { settle = value => typeof value === 'string' ? resolve(value) : reject(value) })
  // 起動/ブラウザ失敗とcallback拒否が競合しても未処理のrejectionを出さない。
  void callback.catch(() => {})
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/plain; charset=utf-8')
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Referrer-Policy', 'no-referrer')
    let url: URL
    try { url = new URL(request.url ?? '/', redirectUri) } catch { response.writeHead(400).end('このURLは使用できません。'); return }
    if (request.method !== 'GET' || request.headers.host !== new URL(redirectUri).host || url.origin !== new URL(redirectUri).origin || url.pathname !== '/') {
      response.writeHead(404).end('このURLは使用できません。'); return
    }
    const returnedState = url.searchParams.get('state') ?? ''
    const stateBytes = Buffer.from(returnedState)
    const expectedBytes = Buffer.from(state)
    const stateOk = stateBytes.length === expectedBytes.length && timingSafeEqual(stateBytes, expectedBytes)
    const unique = ['state', 'code', 'error', 'iss'].every(key => url.searchParams.getAll(key).length <= 1)
    if (!stateOk || !unique || (url.searchParams.has('iss') && url.searchParams.get('iss') !== GOOGLE_ISSUER)) {
      response.writeHead(400).end('認証の確認に失敗しました。ターミナルへ戻ってください。')
      settle?.(new GoogleConnectError('認証応答がこの接続の要求と一致しません。資格情報は保存していません。')); return
    }
    if (url.searchParams.has('error')) {
      response.writeHead(400).end('許可されませんでした。ターミナルへ戻ってください。')
      settle?.(new GoogleConnectError('Googleの許可がキャンセルまたは拒否されました。資格情報は保存していません。')); return
    }
    const code = url.searchParams.get('code')
    if (!nonempty(code)) {
      response.writeHead(400).end('認証応答が不正です。ターミナルへ戻ってください。')
      settle?.(new GoogleConnectError('Googleの認証応答に必要な情報がありません。資格情報は保存していません。')); return
    }
    response.end('ブラウザでの操作を受け取りました。接続の確認結果はターミナルで確認してください。')
    settle?.(code)
  })
  server.headersTimeout = 5_000
  server.requestTimeout = 5_000
  const abort = () => settle?.(new GoogleConnectError('接続を中止しました（キャンセルまたは時間切れ）。資格情報は保存していません。'))
  signal.addEventListener('abort', abort, { once: true })
  try {
    signal.throwIfAborted()
    await new Promise<void>((resolve, reject) => {
      server.once('error', () => reject(new GoogleConnectError('ローカルの認証受付を開始できませんでした。')))
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    if (!address || typeof address === 'string') failure('ローカルの認証受付を開始できませんでした。')
    redirectUri = `http://127.0.0.1:${address.port}/`
    const url = new URL(GOOGLE_ISSUER + '/o/oauth2/v2/auth')
    url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code',
      scope: GOOGLE_READ_SCOPES.join(' '), access_type: 'offline', prompt: 'consent', state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString()
    await Promise.race([browser(url.toString()), callback.then(() => undefined)])
    const code = await callback
    signal.throwIfAborted()
    return { code, verifier, redirectUri }
  } finally {
    signal.removeEventListener('abort', abort)
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}

async function jsonRequest(request: typeof fetch, url: string, init: RequestInit, signal: AbortSignal): Promise<Record<string, unknown>> {
  const response = await request(url, { ...init, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) })
  if (!response.ok) failure('Googleへの接続確認に失敗しました。APIの有効化・権限・接続環境を確認してください。')
  const data: unknown = await response.json()
  if (!data || typeof data !== 'object' || Array.isArray(data)) failure('Googleからの応答が不正です。資格情報は保存していません。')
  return data as Record<string, unknown>
}

/** 本文・件数・予定名を表示/保存せず、本人の識別と読み取りAPIの成功だけを確認する。 */
export async function verifyGoogleReadConnection(email: string, token: string, request: typeof fetch = fetch, signal = AbortSignal.timeout(90_000)): Promise<void> {
  const headers = { Authorization: `Bearer ${token}` }
  const user = await jsonRequest(request, GOOGLE_USERINFO_ENDPOINT, { headers }, signal)
  if (!nonempty(user.sub) || user.email_verified !== true || !sameEmail(user.email, email)) failure('Googleで選んだ本人確認済みアカウントが設定と一致しません。資格情報は保存していません。')
  const gmail = await jsonRequest(request, 'https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers }, signal)
  if (!sameEmail(gmail.emailAddress, email)) failure('Gmailの対象アカウントが設定と一致しません。資格情報は保存していません。')
  const calendar = await jsonRequest(request, 'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1', { headers }, signal)
  if (calendar.kind !== 'calendar#calendarList') failure('Calendarの読み取り応答を確認できませんでした。資格情報は保存していません。')
}

/** ハードリンクで排他的に公開する。renameによる既存ファイル置換はしない。 */
export function saveGoogleCredential(path: string, record: Record<string, unknown>, protect = protectGoogleSecretFile): void {
  const temporary = join(resolve(path, '..'), '.oauth-' + randomBytes(16).toString('hex') + '.tmp')
  let descriptor: number | undefined
  try {
    descriptor = openSync(temporary, 'wx', 0o600)
    protect(temporary)
    writeFileSync(descriptor, JSON.stringify(record, null, 2) + '\n')
    fsyncSync(descriptor)
    closeSync(descriptor); descriptor = undefined
    linkSync(temporary, path)
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
    if (existing(temporary)) unlinkSync(temporary)
  }
}

export async function connectGoogleReadOnly(options: GoogleConnectOptions): Promise<void> {
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), options.timeoutMs ?? 300_000)
  const signal = AbortSignal.any([timeout.signal, ...(options.signal ? [options.signal] : [])])
  try {
    if (!nonempty(options.clientId) || !options.clientId.endsWith('.apps.googleusercontent.com') || !nonempty(options.clientSecret)) failure('自分のデスクトップOAuthクライアントID・シークレットを.envに入力してください。')
    signal.throwIfAborted()
    const path = prepareStore(options)
    probeStorePermissions(path, options.protectFile)
    signal.throwIfAborted()
    const { code, verifier, redirectUri } = await authorizationCode(options.clientId, signal, options.openBrowser ?? openGoogleBrowser)
    const request = options.fetch ?? fetch
    const token = await jsonRequest(request, GOOGLE_TOKEN_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: options.clientId, client_secret: options.clientSecret, code, code_verifier: verifier,
        redirect_uri: redirectUri, grant_type: 'authorization_code' }) }, signal)
    if (!nonempty(token.access_token) || !nonempty(token.refresh_token) || token.token_type !== 'Bearer'
      || typeof token.expires_in !== 'number' || !Number.isFinite(token.expires_in) || token.expires_in <= 0 || token.expires_in > 86_400) failure('Googleのトークン応答が不正または再接続に必要な権限がありません。資格情報は保存していません。')
    const scopes = typeof token.scope === 'string' ? token.scope.split(/\s+/).filter(Boolean).map(scope => scope === 'https://www.googleapis.com/auth/userinfo.email' ? 'email' : scope) : []
    if (!GOOGLE_READ_SCOPES.every(scope => scopes.includes(scope)) || scopes.some(scope => !(GOOGLE_READ_SCOPES as readonly string[]).includes(scope))) failure('許可された権限が要求した読取り専用の範囲と一致しません。資格情報は保存していません。')
    await verifyGoogleReadConnection(options.email, token.access_token, request, signal)
    signal.throwIfAborted()
    saveGoogleCredential(path, { token: token.access_token, refresh_token: token.refresh_token,
      client_id: options.clientId, client_secret: options.clientSecret, token_uri: GOOGLE_TOKEN_ENDPOINT,
      scopes: [...GOOGLE_READ_SCOPES], expiry: new Date(Date.now() + token.expires_in * 1000).toISOString(),
      katazuku_connection: 'read-only' }, options.protectFile)
  } catch (error) {
    if (error instanceof GoogleConnectError) throw error
    failure('Google接続を完了できませんでした。接続環境・設定・保存権限を確認してください。秘密値は表示せず、既存の資格情報は変更していません。')
  } finally { clearTimeout(timer) }
}

/** 既存の資格情報は変更せず、公開のrefresh処理を再利用する。 */
export async function checkStoredGoogleReadConnection(email: string, directory: string, request: typeof fetch = fetch, env: NodeJS.ProcessEnv = process.env, signal = AbortSignal.timeout(90_000)): Promise<void> {
  try {
    // 保存ファイルのtoken_uriは信頼しない。Google以外へrefresh_tokenを送らない。
    const { readFileSync } = await import('node:fs')
    const stored = JSON.parse(readFileSync(credentialPath(directory, email), 'utf8')) as Record<string, unknown>
    if (stored.token_uri && stored.token_uri !== GOOGLE_TOKEN_ENDPOINT) failure('保存済み資格情報の接続先がGoogleではありません。確認を中止しました。')
    signal.throwIfAborted()
    const token = await getGoogleAccessToken(email, directory, { fetch: (url, init) => request(url, { ...init, redirect: 'error', signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]) }), env })
    await verifyGoogleReadConnection(email, token, request, signal)
  } catch (error) {
    if (error instanceof GoogleConnectError) throw error
    failure('保存済みGoogle資格情報の読取り確認に失敗しました。設定・失効・API権限を確認してください。資格情報は変更していません。')
  }
}
