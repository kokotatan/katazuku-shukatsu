import { DurableObject } from 'cloudflare:workers'
import { OAuthProvider, type OAuthHelpers, type OAuthResourceContext } from '@cloudflare/workers-oauth-provider'
import { allowedSparkRemoteRequest } from '../src/spark-remote-policy'
import { ICONS } from './icons'

type Bindings = Env & { OAUTH_PROVIDER: OAuthHelpers }
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers })
const escape = (text: string) => text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
async function hash(text: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2, '0')).join('')
}
async function equalSecret(text: string, expectedHash: string) {
  const actual = await hash(text)
  let difference = actual.length ^ expectedHash.length
  for (let i = 0; i < actual.length; i++) difference |= actual.charCodeAt(i) ^ (expectedHash.charCodeAt(i) || 0)
  return difference === 0
}
async function bounded(request: Request, max = 120_000) {
  if (Number(request.headers.get('content-length')) > max) throw new Error('body_limit')
  const reader = request.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []; let size = 0
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break
      size += value.length
      if (size > max) { await reader.cancel(); throw new Error('body_limit') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)
}

/** 所有者1人の中継。依頼内容は永続化せず、切断時は失敗として返す。 */
export class SparkRelay extends DurableObject<Env> {
  pending = new Map<string, { resolve: (value: Response) => void; timer: ReturnType<typeof setTimeout> }>()
  consumeConsent(key: string) {
    // OAuth KVの削除は別拠点へ即時反映されないため、再利用拒否だけはSQLiteで原子的に行う。
    const sql = this.ctx.storage.sql
    sql.exec('CREATE TABLE IF NOT EXISTS consumed_consent (id TEXT PRIMARY KEY, expires INTEGER NOT NULL)')
    sql.exec('DELETE FROM consumed_consent WHERE expires < ?', Date.now())
    return sql.exec('INSERT OR IGNORE INTO consumed_consent(id,expires) VALUES(?,?) RETURNING id', key, Date.now() + 15 * 60_000).toArray().length === 1
  }
  async fetch(request: Request) {
    if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'upgrade_required' }, 426)
    for (const socket of this.ctx.getWebSockets()) socket.close(1000, 'replaced')
    const pair = new WebSocketPair()
    this.ctx.acceptWebSocket(pair[1])
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
    return new Response(null, { status: 101, webSocket: pair[0], headers: { 'Sec-WebSocket-Protocol': 'katazuku-spark' } })
  }
  async relay(body: string): Promise<Response> {
    const socket = this.ctx.getWebSockets()[0]
    if (!socket) return json({ error: 'minipc_offline' }, 503)
    if (this.pending.size >= 8) return json({ error: 'busy' }, 429)
    const id = crypto.randomUUID()
    return new Promise(resolve => {
      const timer = setTimeout(() => { this.pending.delete(id); resolve(json({ error: 'minipc_timeout', retry: 'same_request_key_only' }, 504)) }, 20_000)
      this.pending.set(id, { resolve, timer })
      try { socket.send(JSON.stringify({ id, body, expiresAt: Date.now() + 15_000 })) }
      catch { clearTimeout(timer); this.pending.delete(id); resolve(json({ error: 'minipc_offline' }, 503)) }
    })
  }
  webSocketMessage(_socket: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string' || message.length > 1_200_000) return
    try {
      const reply = JSON.parse(message)
      const item = this.pending.get(reply.id)
      if (!item) return
      clearTimeout(item.timer); this.pending.delete(reply.id)
      item.resolve(reply.notification ? new Response(null, { status: 202, headers }) : json(reply.result))
    } catch { /* 不正な中継応答はタイムアウトとして扱う */ }
  }
  webSocketClose(socket: WebSocket) { socket.close(); this.failPending() }
  webSocketError() { this.failPending() }
  private failPending() {
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.resolve(json({ error: 'minipc_disconnected' }, 503)) }
    this.pending.clear()
  }
  async rate(key: string, max: number) {
    const slot = Math.floor(Date.now() / 60_000)
    // 認証前の試行回数だけを保持。入力・IP・秘密は保存しない。
    const old = await this.ctx.storage.get<{ slot: number; count: number }>(key)
    const count = old?.slot === slot ? old.count + 1 : 1
    await this.ctx.storage.put(key, { slot, count })
    return count <= max
  }
}

const authHandler = {
  async fetch(request: Request, env: Bindings) {
    const url = new URL(request.url)
    if (url.pathname === '/health') return json({ service: 'katazuku-spark-gateway' })
    if (url.pathname !== '/authorize') return json({ error: 'not_found' }, 404)
    const oauth = env.OAUTH_PROVIDER
    if (request.method === 'GET') {
      const auth = await oauth.parseAuthRequest(request)
      const client = await oauth.lookupClient(auth.clientId)
      const details = { clientName: client?.clientName || 'MCP client', redirectHost: new URL(auth.redirectUri).host }
      const consent = await oauth.beginConsent(auth)
      consent.headers.set('Content-Type', 'text/html; charset=utf-8')
      consent.headers.set('Cache-Control', 'no-store')
      // no-referrer だとChromeはフォームPOSTのOriginをnullにし、下のOrigin照合で必ず弾かれる。
      // same-originなら自分宛てにだけOriginが付き、戻り先(外部)へは何も送らない。
      consent.headers.set('Referrer-Policy', 'same-origin')
      return new Response(`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>katazuku Spark 接続</title><link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png"><h1>katazuku Spark 接続</h1><p>接続アプリ: ${escape(details.clientName)}（アプリ名は自己申告です）</p><p>戻り先: ${escape(details.redirectHost)}</p><p>許可する操作: 調査・草案の依頼追加、依頼一覧・進捗・結果の取得。</p><p>メール送信・予約確定・コマンド実行は含みません。</p><form method="post"><input type="hidden" name="handle" value="${escape(consent.handle)}"><label>専用の接続キー <input type="password" name="ownerKey" autocomplete="current-password" required></label><p><button name="decision" value="approve">接続を許可</button><button name="decision" value="deny" formnovalidate>キャンセル</button></p></form></html>`, { headers: consent.headers })
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
    const approved = await oauth.approveConsent(request, handle, { scope: ['spark:tasks'] })
    if (!await env.RELAY.getByName('owner').consumeConsent(await hash(handle))) return json({ error: 'consent_used' }, 400)
    const { redirectTo } = await oauth.completeAuthorization({ request: approved.request, userId: 'owner', metadata: {}, scope: ['spark:tasks'], props: { userId: 'owner' } })
    approved.headers.set('Location', redirectTo)
    return new Response(null, { status: 303, headers: approved.headers })
  },
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    try {
      const url = new URL(request.url)
      if (url.origin !== env.PUBLIC_ORIGIN) return json({ error: 'invalid_host' }, 403)
      // アイコンは公開情報。認証前に返す(Geminiのアプリ一覧と同意画面のファビコン)
      const icon = request.method === 'GET' || request.method === 'HEAD' ? ICONS[url.pathname] : undefined
      if (icon && !url.search) return new Response(request.method === 'HEAD' ? null : icon, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' } })
      if (url.pathname === '/bridge') {
        if (request.method !== 'GET' || url.search || request.headers.has('Origin')) return json({ error: 'forbidden' }, 403)
        const protocols = request.headers.get('Sec-WebSocket-Protocol')?.split(',').map(p => p.trim()) || []
        const token = protocols.find(p => p.startsWith('auth.'))?.slice(5) || ''
        if (!protocols.includes('katazuku-spark') || !await equalSecret(token, await hash(env.BRIDGE_TOKEN))) return json({ error: 'unauthorized' }, 401)
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
        scopesSupported: ['spark:tasks'], disallowPublicClientRegistration: false,
        accessTokenTTL: 3600,
        resourceMetadata: { resource: `${env.PUBLIC_ORIGIN}/mcp`, authorization_servers: [env.PUBLIC_ORIGIN], scopes_supported: ['spark:tasks'] },
        apiHandler: { async fetch(req, bindings, context) {
          if (new URL(req.url).pathname !== '/mcp' || new URL(req.url).search) return json({ error: 'not_found' }, 404)
          if (req.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } })
          if (!(context as OAuthResourceContext<unknown>).auth.scope.includes('spark:tasks')) return json({ error: 'insufficient_scope' }, 403)
          if (!req.headers.get('Content-Type')?.startsWith('application/json')) return json({ error: 'content_type' }, 415)
          const version = req.headers.get('MCP-Protocol-Version')
          if (version && version !== '2025-06-18') return json({ error: 'protocol_version' }, 400)
          const body = await bounded(req)
          const rpc = JSON.parse(body)
          if (!allowedSparkRemoteRequest(rpc)) return json({ jsonrpc: '2.0', id: typeof rpc?.id === 'string' || typeof rpc?.id === 'number' ? rpc.id : null, error: { code: -32601, message: '公開していない操作です' } })
          return bindings.RELAY.getByName('owner').relay(body)
        } },
        defaultHandler: authHandler,
      })
      const response = await provider.fetch(request, env as Bindings, ctx)
      if (response.ok && authorizationCode && !await env.RELAY.getByName('owner').consumeConsent('code:' + await hash(authorizationCode))) return json({ error: 'invalid_grant' }, 400)
      return response
    } catch { return json({ error: 'invalid_request' }, 400) }
  },
} satisfies ExportedHandler<Env>
