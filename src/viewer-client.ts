import { boundedJson, connectionOrigin } from './http-boundary.js'
import { MAX_SNAPSHOT_BYTES, validateSnapshot } from './snapshot-contract.js'
import type { KatazukuData } from './viewer-types.js'
import { derivePasswordProof } from './password-proof.js'

export interface ViewerConnection { origin: string; instanceId: string; deviceName: string }
interface Session extends ViewerConnection { token: string; expiresAt: number }
export interface ViewerState { revision: number; connection: ViewerConnection | null; expiresAt: number | null; notice?: string }
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const SESSION_KEY = 'katazuku.viewer.session.v1'
export const CONNECTION_CHANGE_KEY = 'katazuku.viewer.change.v1'
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const aborted = () => new DOMException('接続が変更されました。', 'AbortError')

export class ViewerError extends Error {
  constructor(readonly kind: 'disconnected' | 'unauthorized' | 'not-synced' | 'connection' | 'busy' | 'invalid', message: string) { super(message) }
}
function responseError(status: number): ViewerError {
  if (status === 401) return new ViewerError('unauthorized', '連携の有効期限が切れたか、接続が解除されています。PCからもう一度連携してください。')
  if (status === 404) return new ViewerError('not-synced', 'PCからの同期を待っています。PCで katazuku を開き、同期の状態を確認してください。')
  if (status === 429) return new ViewerError('busy', '接続が混み合っています。1分ほど待ってから、もう一度お試しください。')
  if (status === 409) return new ViewerError('connection', '接続先の設定が変わっています。PCからもう一度連携してください。')
  return new ViewerError('connection', '接続できませんでした。インターネット接続とPCの同期状態を確認してから、もう一度お試しください。')
}

/** 一つのタブの閲覧接続。長期キーと個人データは保存しない。 */
export class ViewerClient {
  private session: Session | null = null
  private state: ViewerState = { revision: 0, connection: null, expiresAt: null }
  private active = new AbortController()
  private timer: ReturnType<typeof setTimeout> | undefined
  private listeners = new Set<() => void>()
  constructor(private options: { fetch?: typeof fetch; storage?: StoragePort; broadcast?: () => void; now?: () => number } = {}) {
    try {
      const saved: unknown = JSON.parse(options.storage?.getItem(SESSION_KEY) || 'null')
      if (this.isSession(saved)) this.setSession(saved)
      else options.storage?.removeItem(SESSION_KEY)
    } catch { /* 保存を禁止したブラウザでも、同じページ内では利用できる。 */ }
  }
  private now = () => this.options.now?.() ?? Date.now()
  private isSession(value: unknown): value is Session {
    if (!record(value)) return false
    try {
      return typeof value.origin === 'string' && connectionOrigin(value.origin) === value.origin
        && typeof value.instanceId === 'string' && /^[a-f0-9]{32}$/.test(value.instanceId)
        && typeof value.deviceName === 'string' && value.deviceName.length <= 80
        && typeof value.token === 'string' && /^ktz_session_\d{10}_[A-Za-z0-9_-]{43}$/.test(value.token)
        && typeof value.expiresAt === 'number' && value.expiresAt > this.now() && value.expiresAt <= this.now() + 30 * 60_000
    } catch { return false }
  }
  getState = (): ViewerState => this.state
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private changed() { for (const listener of this.listeners) listener() }
  private save(session: Session | null) {
    try {
      if (session) this.options.storage?.setItem(SESSION_KEY, JSON.stringify(session))
      else this.options.storage?.removeItem(SESSION_KEY)
    } catch { /* ストレージが使えない場合はメモリ内だけで継続する。 */ }
  }
  private setSession(session: Session) {
    this.session = session
    this.state = { revision: this.state.revision + 1, connection: { origin: session.origin, instanceId: session.instanceId, deviceName: session.deviceName }, expiresAt: session.expiresAt }
    this.save(session)
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.checkExpiry(), Math.max(1, session.expiresAt - this.now()))
    this.changed()
  }
  /** 応答を待たず画面から消す。別タブからの解除も同じ経路を通る。 */
  invalidate(broadcast = true, notice = ''): void {
    this.active.abort()
    this.active = new AbortController()
    this.session = null
    this.state = { revision: this.state.revision + 1, connection: null, expiresAt: null, notice }
    clearTimeout(this.timer)
    this.save(null)
    this.changed()
    if (broadcast) this.options.broadcast?.()
  }
  checkExpiry(): void { if (this.session && this.session.expiresAt <= this.now()) this.invalidate(true, '閲覧の有効期限が切れました。PCからもう一度連携してください。') }
  refresh(): void { this.state = { ...this.state, revision: this.state.revision + 1 }; this.changed() }
  private async request(origin: string, path: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
    try {
      return await (this.options.fetch ?? fetch)(`${origin}${path}`, {
        ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]), credentials: init.credentials ?? 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
      })
    } catch {
      if (signal.aborted) throw aborted()
      throw responseError(503)
    }
  }
  private async info(origin: string, signal: AbortSignal): Promise<string> {
    const response = await this.request(origin, '/api/info', {}, signal)
    if (!response.ok) throw responseError(response.status)
    const info = await boundedJson(response, 4096)
    if (!record(info) || info.protocolVersion !== 1 || typeof info.instanceId !== 'string' || !/^[a-f0-9]{32}$/.test(info.instanceId)) throw new ViewerError('invalid', 'この接続先には対応していません。PCで接続の設定を確認してください。')
    return info.instanceId
  }
  private async revoke(session: Session): Promise<void> {
    const response = await this.request(session.origin, '/api/session', { method: 'DELETE', headers: { Authorization: `Bearer ${session.token}` } }, new AbortController().signal)
    if (!response.ok && response.status !== 401) throw responseError(response.status)
  }
  async disconnect(): Promise<void> {
    const previous = this.session
    this.invalidate()
    if (previous) await this.revoke(previous)
  }
  async connect(value: string, credential: { pairingCode: string } | { readKey: string } | { password: string } | { browserSession: true }): Promise<void> {
    const origin = connectionOrigin(value)
    const previous = this.session
    this.invalidate()
    const signal = this.active.signal
    // 解除に失敗した時は新しい接続へ進めない。旧セッションは最長30分で期限切れになる。
    if (previous) await this.revoke(previous)
    if (signal.aborted) throw aborted()
    const id = await this.info(origin, signal)
    if (signal.aborted) throw aborted()
    let payload: Record<string, unknown> = credential
    if ('password' in credential) {
      const challenge = await this.request(origin, '/api/auth/challenge', {}, signal)
      if (!challenge.ok) throw responseError(challenge.status)
      payload = { passwordProof: await derivePasswordProof(credential.password, await boundedJson(challenge, 4096)) }
    }
    if (signal.aborted) throw aborted()
    const response = await this.request(origin, '/api/session', {
      method: 'POST', ...('browserSession' in credential ? { credentials: 'same-origin' as const } : {}), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instanceId: id, ...payload }),
    }, signal)
    if (!response.ok) throw responseError(response.status)
    const valueResponse = await boundedJson(response, 4096)
    if (signal.aborted) throw aborted()
    const session = record(valueResponse) ? { ...valueResponse, origin } : null
    if (!this.isSession(session) || session.instanceId !== id || valueResponse && record(valueResponse) && valueResponse.protocolVersion !== 1) throw new ViewerError('invalid', '連携を確認できませんでした。PCからやり直してください。')
    this.setSession(session)
  }
  async data(signal?: AbortSignal): Promise<KatazukuData> {
    this.checkExpiry()
    const session = this.session
    if (!session) throw new ViewerError('disconnected', 'データを表示するには、使っているPCと連携してください。')
    const active = AbortSignal.any([this.active.signal, ...(signal ? [signal] : [])])
    try {
      const id = await this.info(session.origin, active)
      if (active.aborted) throw aborted()
      if (id !== session.instanceId) { this.invalidate(true, '保存先の設定が変わりました。PCからもう一度連携してください。'); throw responseError(409) }
      const response = await this.request(session.origin, '/api/data', { headers: { Authorization: `Bearer ${session.token}` } }, active)
      if (active.aborted) throw aborted()
      if (response.status === 401) { this.invalidate(true, '連携の有効期限が切れたか、接続が解除されています。PCからもう一度連携してください。'); throw responseError(401) }
      if (!response.ok) throw responseError(response.status)
      const value = await boundedJson(response, MAX_SNAPSHOT_BYTES)
      validateSnapshot(value)
      if (active.aborted || this.session !== session) throw aborted()
      return value
    } catch (error) {
      if (error instanceof ViewerError || error instanceof DOMException && error.name === 'AbortError') throw error
      throw new ViewerError('invalid', 'データを正しく読み取れませんでした。PCで同期をやり直してください。')
    }
  }
  dispose(): void { this.active.abort(); clearTimeout(this.timer); this.listeners.clear() }
}
