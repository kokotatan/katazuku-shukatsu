import { DurableObject } from 'cloudflare:workers'
import { OAuthProvider, type OAuthHelpers, type OAuthResourceContext } from '@cloudflare/workers-oauth-provider'
import { allowedKatazukuRemoteRequest, KATAZUKU_REMOTE_SCOPES } from '../src/katazuku-remote-policy'

type Bindings = Env & { OAUTH_PROVIDER: OAuthHelpers }
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers })
const escape = (value: string) => value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`)
const labels: Record<string, string> = {
  'katazuku:read': '予定・選考・空き・提出物・要対応メール要約の読取り',
  'katazuku:write': '取得済み事実の正本DBへの冪等な記録',
  'katazuku:sensitive': 'プロフィール・人脈・面談記録・企業研究の読取り',
  'katazuku:actions': '第三者操作の承認提案と状態確認（実行・承認は不可）',
}

async function hash(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
    (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function equalSecret(value: string, expectedHash: string): Promise<boolean> {
  const actual = await hash(value)
  let difference = actual.length ^ expectedHash.length
  for (let index = 0; index < actual.length; index++) difference |= actual.charCodeAt(index) ^ (expectedHash.charCodeAt(index) || 0)
  return difference === 0
}

async function bounded(request: Request, maximum = 1_200_000): Promise<string> {
  if (Number(request.headers.get('content-length')) > maximum) throw new Error('body_limit')
  const reader = request.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.length
      if (size > maximum) { await reader.cancel(); throw new Error('body_limit') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)
}

/** DBやtool payloadを保存せず、所有者の端末へ有効期限つきで中継する。 */
export class MuseRelay extends DurableObject<Env> {
  private pending = new Map<string, { resolve: (response: Response) => void; timer: ReturnType<typeof setTimeout> }>()

  consume(key: string): boolean {
    const sql = this.ctx.storage.sql
    sql.exec('CREATE TABLE IF NOT EXISTS consumed (id TEXT PRIMARY KEY, expires INTEGER NOT NULL)')
    sql.exec('DELETE FROM consumed WHERE expires < ?', Date.now())
    return sql.exec('INSERT OR IGNORE INTO consumed(id,expires) VALUES(?,?) RETURNING id', key, Date.now() + 15 * 60_000).toArray().length === 1
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'upgrade_required' }, 426)
    for (const socket of this.ctx.getWebSockets()) socket.close(1000, 'replaced')
    const pair = new WebSocketPair()
    this.ctx.acceptWebSocket(pair[1])
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
    return new Response(null, { status: 101, webSocket: pair[0], headers: { 'Sec-WebSocket-Protocol': 'katazuku-muse' } })
  }

  async relay(body: string, scopes: readonly string[]): Promise<Response> {
    const socket = this.ctx.getWebSockets()[0]
    if (!socket) return json({ error: 'owner_device_offline' }, 503)
    if (this.pending.size >= 8) return json({ error: 'busy' }, 429)
    const id = crypto.randomUUID()
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.pending.delete(id); resolve(json({ error: 'owner_device_timeout' }, 504)) }, 20_000)
      this.pending.set(id, { resolve, timer })
      try { socket.send(JSON.stringify({ id, body, scopes, expiresAt: Date.now() + 15_000 })) }
      catch { clearTimeout(timer); this.pending.delete(id); resolve(json({ error: 'owner_device_offline' }, 503)) }
    })
  }

  webSocketMessage(_socket: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message !== 'string' || message.length > 1_200_000) return
    try {
      const reply = JSON.parse(message) as { id?: unknown; result?: unknown; notification?: unknown }
      if (typeof reply.id !== 'string') return
      const item = this.pending.get(reply.id)
      if (!item) return
      clearTimeout(item.timer)
      this.pending.delete(reply.id)
      item.resolve(reply.notification ? new Response(null, { status: 202, headers }) : json(reply.result))
    } catch { /* 不正な応答は期限切れまで待ち、成功にしない。 */ }
  }

  webSocketClose(socket: WebSocket): void { socket.close(); this.failPending() }
  webSocketError(): void { this.failPending() }
  private failPending(): void {
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.resolve(json({ error: 'owner_device_disconnected' }, 503)) }
    this.pending.clear()
  }

  async rate(key: string, maximum: number): Promise<boolean> {
    const slot = Math.floor(Date.now() / 60_000)
    const previous = await this.ctx.storage.get<{ slot: number; count: number }>(key)
    const count = previous?.slot === slot ? previous.count + 1 : 1
    await this.ctx.storage.put(key, { slot, count })
    return count <= maximum
  }
}

const authHandler = {
  async fetch(request: Request, env: Bindings): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/health') return json({ service: 'katazuku-muse-gateway' })
    if (url.pathname !== '/authorize') return json({ error: 'not_found' }, 404)
    const oauth = env.OAUTH_PROVIDER
    if (request.method === 'GET') {
      const auth = await oauth.parseAuthRequest(request)
      const client = await oauth.lookupClient(auth.clientId)
      const consent = await oauth.beginConsent(auth)
      const requested = auth.scope.filter((scope) => KATAZUKU_REMOTE_SCOPES.includes(scope as typeof KATAZUKU_REMOTE_SCOPES[number]))
      const scopeFields = requested.map((scope) => `<label><input type="checkbox" name="scope" value="${escape(scope)}" checked> ${escape(labels[scope] || scope)}</label><br>`).join('')
      consent.headers.set('Content-Type', 'text/html; charset=utf-8')
      consent.headers.set('Cache-Control', 'no-store')
      consent.headers.set('Referrer-Policy', 'same-origin')
      return new Response(`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>katazuku接続</title><h1>katazukuを接続</h1><p>接続アプリ: ${escape(client?.clientName || 'MCP client')}（自己申告）</p><p>戻り先: ${escape(new URL(auth.redirectUri).host)}</p><form method="post"><input type="hidden" name="handle" value="${escape(consent.handle)}"><fieldset><legend>許可する範囲</legend>${scopeFields}</fieldset><p>資格情報・任意SQL・シェル・メール送信・予約確定・応募提出はどのscopeにも含まれません。</p><label>専用の接続キー <input type="password" name="ownerKey" autocomplete="current-password" required></label><p><button name="decision" value="approve">接続を許可</button><button name="decision" value="deny" formnovalidate>キャンセル</button></p></form></html>`, { headers: consent.headers })
    }
    if (request.method !== 'POST' || request.headers.get('Origin') !== env.PUBLIC_ORIGIN) return json({ error: 'invalid_origin' }, 403)
    if (!await env.RELAY.getByName('owner').rate('login', 10)) return json({ error: 'rate_limited' }, 429)
    const form = new URLSearchParams(await bounded(request, 4096))
    const handle = form.get('handle') || ''
    if (form.get('decision') !== 'approve') {
      const denied = await oauth.denyConsent(request, handle)
      return new Response(null, { status: 303, headers: denied.headers })
    }
    if (!await equalSecret(form.get('ownerKey') || '', env.OWNER_KEY_SHA256)) return json({ error: 'invalid_owner_key' }, 401)
    const approved = await oauth.approveConsent(request, handle, { scope: form.getAll('scope') })
    if (!await env.RELAY.getByName('owner').consume(await hash(handle))) return json({ error: 'consent_used' }, 400)
    const { redirectTo } = await oauth.completeAuthorization({ request: approved.request, userId: 'owner', metadata: {}, scope: approved.request.scope, props: { userId: 'owner' } })
    approved.headers.set('Location', redirectTo)
    return new Response(null, { status: 303, headers: approved.headers })
  },
}

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url)
      if (url.origin !== env.PUBLIC_ORIGIN) return json({ error: 'invalid_host' }, 403)
      if (url.pathname === '/bridge') {
        if (request.method !== 'GET' || url.search || request.headers.has('Origin')) return json({ error: 'forbidden' }, 403)
        const protocols = request.headers.get('Sec-WebSocket-Protocol')?.split(',').map((value) => value.trim()) || []
        const token = protocols.find((value) => value.startsWith('auth.'))?.slice(5) || ''
        if (!protocols.includes('katazuku-muse') || !await equalSecret(token, await hash(env.BRIDGE_TOKEN))) return json({ error: 'unauthorized' }, 401)
        return env.RELAY.getByName('owner').fetch(request)
      }
      if (request.headers.has('Origin') && request.headers.get('Origin') !== env.PUBLIC_ORIGIN) return json({ error: 'invalid_origin' }, 403)
      let authorizationCode: string | undefined
      if (request.method === 'POST' && url.pathname !== '/mcp') {
        if (!await env.RELAY.getByName('owner').rate('oauth', 60)) return json({ error: 'rate_limited' }, 429)
        const body = await bounded(request, 16_384)
        if (url.pathname === '/oauth/token') {
          const form = new URLSearchParams(body)
          if (form.get('grant_type') === 'authorization_code') authorizationCode = form.get('code') || undefined
        }
        request = new Request(request, { body })
      }
      const provider = new OAuthProvider<Bindings>({
        apiRoute: '/mcp', authorizeEndpoint: '/authorize', tokenEndpoint: '/oauth/token', clientRegistrationEndpoint: '/oauth/register',
        scopesSupported: [...KATAZUKU_REMOTE_SCOPES], disallowPublicClientRegistration: false, accessTokenTTL: 3600,
        resourceMetadata: { resource: `${env.PUBLIC_ORIGIN}/mcp`, authorization_servers: [env.PUBLIC_ORIGIN], scopes_supported: [...KATAZUKU_REMOTE_SCOPES] },
        apiHandler: { async fetch(inner, bindings, resourceContext) {
          const innerUrl = new URL(inner.url)
          if (innerUrl.pathname !== '/mcp' || innerUrl.search) return json({ error: 'not_found' }, 404)
          if (inner.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } })
          if (!inner.headers.get('Content-Type')?.startsWith('application/json')) return json({ error: 'content_type' }, 415)
          const version = inner.headers.get('MCP-Protocol-Version')
          if (version && version !== '2025-06-18') return json({ error: 'protocol_version' }, 400)
          const body = await bounded(inner)
          const rpc = JSON.parse(body)
          const scopes = (resourceContext as OAuthResourceContext<unknown>).auth.scope
          if (!allowedKatazukuRemoteRequest(rpc, scopes)) return json({ jsonrpc: '2.0', id: typeof rpc?.id === 'string' || typeof rpc?.id === 'number' ? rpc.id : null, error: { code: -32601, message: 'scopeで許可されていない操作です' } })
          return bindings.RELAY.getByName('owner').relay(body, scopes)
        } },
        defaultHandler: authHandler,
      })
      const response = await provider.fetch(request, env as Bindings, context)
      if (response.ok && authorizationCode && !await env.RELAY.getByName('owner').consume(`code:${await hash(authorizationCode)}`)) return json({ error: 'invalid_grant' }, 400)
      return response
    } catch { return json({ error: 'invalid_request' }, 400) }
  },
} satisfies ExportedHandler<Env>
