/**
 * HTTP型 provider(anthropic-api / openai-api / chatgpt-siwc)のチェック。ネットワークは使わず fetch を差し替える。
 *   npm run test:providers
 */
import { createSign, generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseProviderOrder, runAgent, type AgentRunRequest } from '../src/agent-runtime.js'
import { buildAnthropicRequest, createAnthropicApiAdapter } from '../src/providers/anthropic-api.js'
import {
  base64url,
  buildAuthorizationAttempt,
  buildCredentialRecord,
  createChatGptPlanAdapter,
  createPkce,
  ensureFreshCredential,
  getOrCreateHostId,
  loadCredential,
  redactAuthorizationUrl,
  saveCredential,
  setActiveLabel,
  signOut,
  SignInRequiredError,
  validateCallback,
  verifyIdToken,
  type CredentialRecord,
  type Discovery,
} from '../src/providers/chatgpt-siwc.js'
import { readSse } from '../src/providers/http.js'
import { createOpenAiApiAdapter } from '../src/providers/openai-api.js'
import { buildResponsesBody, callResponses } from '../src/providers/openai-responses.js'
import { createHash } from 'node:crypto'

let failed = 0
function check(label: string, cond: boolean, detail = '') {
  console.log(`${cond ? '[ok]' : '[FAIL]'} ${label}${cond ? '' : ` — ${detail}`}`)
  if (!cond) failed++
}

function sse(events: unknown[]): Response {
  const text = events.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join('')
  return new Response(new ReadableStream({
    start(controller) {
      // 途中で分割して届く場合も組み立てられるか確かめるため、3バイトずつ流す
      const bytes = new TextEncoder().encode(text)
      for (let index = 0; index < bytes.length; index += 3) controller.enqueue(bytes.slice(index, index + 3))
      controller.close()
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

const request = (overrides: Partial<AgentRunRequest> = {}): AgentRunRequest => ({
  runId: 'run-' + Math.random().toString(36).slice(2), workflowId: 'daily-sync', prompt: 'P', cwd: '.', capabilities: [],
  risk: 'read-only', sideEffectMode: 'none', ...overrides,
})

// ---- 共通 ----
{
  const events: string[] = []
  for await (const event of readSse(sse([{ a: 1 }, { b: 2 }]).body!)) events.push(event.data)
  check('SSE: 分割されて届いたイベントを組み立てる', events.length === 2 && JSON.parse(events[1]).b === 2)
  check('provider 名の別名(claude-cli / codex-cli)を受け付ける', parseProviderOrder('claude-cli,codex-cli,chatgpt-siwc').join(',') === 'claude,codex,chatgpt-siwc')
}

// ---- anthropic-api ----
{
  const built = buildAnthropicRequest('hello', { ANTHROPIC_API_KEY: 'test-key' })
  check('Anthropic: 既定モデルと必須ヘッダ', built.body.model === 'claude-opus-5-5' && built.headers['anthropic-version'] === '2023-06-01' && built.body.stream === true)
  check('Anthropic: 拒否時のサーバ側フォールバックは既定で有効', built.body.fallbacks === 'default' && built.headers['anthropic-beta'] === 'server-side-fallback-2026-07-01')
  const adapter = createAnthropicApiAdapter({
    env: { ANTHROPIC_API_KEY: 'test-key' },
    fetch: async () => sse([
      { type: 'message_start' },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: '{"ok"' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: ':true}' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
    ]),
  })
  check('Anthropic: ツールを要求する工程は preflight で飛ばす', !(await adapter.preflight(request({ capabilities: ['gmail.read'] }), async () => { throw new Error() })).ok)
  check('Anthropic: キーが無ければ auth_unavailable', (await createAnthropicApiAdapter({ env: {} }).preflight(request(), async () => { throw new Error() })).failure === 'auth_unavailable')
  const root = mkdtempSync(join(tmpdir(), 'katazuku-providers-'))
  try {
    const result = await runAgent(request({ providerOrder: ['anthropic-api'] }), { adapters: [adapter], artifactDir: root })
    check('Anthropic: ストリームの本文を最終出力として返す', result.status === 'succeeded' && result.output === '{"ok":true}', JSON.stringify(result))
    const overloaded = createAnthropicApiAdapter({ env: { ANTHROPIC_API_KEY: 'k' }, fetch: async () => new Response('{"type":"error"}', { status: 529 }) })
    const next = createOpenAiApiAdapter({ env: { OPENAI_API_KEY: 'k', KATAZUKU_OPENAI_MODEL: 'test-model' }, fetch: async () => sse([{ type: 'response.output_text.delta', delta: 'fallback' }, { type: 'response.completed' }]) })
    const fell = await runAgent(request({ providerOrder: ['anthropic-api', 'openai-api'] }), { adapters: [overloaded, next], artifactDir: root })
    check('混雑(529)は副作用前の失敗として次の provider へ回す', fell.status === 'succeeded' && fell.provider === 'openai-api' && fell.attempts[0].failure === 'rate_limited')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

// ---- openai-api / Responses ----
{
  const body = buildResponsesBody({ model: 'm', prompt: 'p' })
  const forbidden = ['temperature', 'max_output_tokens', 'metadata', 'previous_response_id', 'background', 'top_p', 'user']
  check('Responses: store:false / stream:true、非対応の項目を送らない', body.store === false && body.stream === true && forbidden.every((key) => !(key in body)))
  const failed1 = await callResponses({ token: 't', model: 'm', prompt: 'p', timeoutMs: 5000, fetch: async () => sse([{ type: 'response.output_text.delta', delta: 'x' }, { type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } } }]) })
  check('Responses: ストリーム途中の使用量上限は quota_exhausted', failed1.failure === 'quota_exhausted')
  const cut = await callResponses({ token: 't', model: 'm', prompt: 'p', timeoutMs: 5000, fetch: async () => sse([{ type: 'response.output_text.delta', delta: 'x' }]) })
  check('Responses: response.completed が無ければ成功にしない', cut.failure === 'connection_failed')
  const admission = await callResponses({ token: 't', model: 'm', prompt: 'p', timeoutMs: 5000, fetch: async () => new Response('{"detail":"not enabled"}', { status: 503 }) })
  check('Responses: 開始前の {"detail"} 形の拒否も分類する', admission.failure === 'connection_failed' && (admission.diagnostic ?? '').includes('503'))
  check('openai-api: モデル未設定なら使わない', (await createOpenAiApiAdapter({ env: { OPENAI_API_KEY: 'k' } }).preflight(request(), async () => { throw new Error() })).failure === 'capability_missing')
}

// ---- chatgpt-siwc(Sign in with ChatGPT) ----
const discovery: Discovery = {
  issuer: 'https://auth.openai.com',
  authorization_endpoint: 'https://auth.openai.com/api/accounts/authorize',
  token_endpoint: 'https://auth.openai.com/api/accounts/oauth/token',
  revocation_endpoint: 'https://auth.openai.com/api/accounts/oauth/revoke',
  jwks_uri: 'https://auth.openai.com/.well-known/jwks.json',
}
{
  const pkce = createPkce()
  check('PKCE: challenge は verifier の SHA-256 を base64url(パディング無し)', pkce.challenge === base64url(createHash('sha256').update(pkce.verifier).digest()) && !pkce.challenge.includes('='))
  const dir = mkdtempSync(join(tmpdir(), 'katazuku-siwc-'))
  try {
    const hostId = getOrCreateHostId(dir)
    check('ホストID: urn:uuid 形式で、2回目も同じ値', /^urn:uuid:[0-9a-f-]{36}$/.test(hostId) && getOrCreateHostId(dir) === hostId)
    if (process.platform !== 'win32') check('資格情報ファイルは所有者だけが読める(0600)', (statSync(join(dir, 'host.json')).mode & 0o777) === 0o600)

    const first = buildAuthorizationAttempt({ discovery, hostId, port: 1455 })
    const url = new URL(first.url)
    check('認可URL(初回): dynamic_agent_client・agent_name_hint・ホストID・PKCE・resource・127.0.0.1', url.searchParams.get('client_id') === 'dynamic_agent_client'
      && url.searchParams.get('agent_name_hint') === 'katazuku' && url.searchParams.get('ext_agent_host_id') === hostId
      && url.searchParams.get('code_challenge_method') === 'S256' && url.searchParams.get('resource') === 'https://api.openai.com/v1'
      && url.searchParams.get('redirect_uri') === 'http://127.0.0.1:1455/auth/callback'
      && url.searchParams.get('scope') === 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct')
    const again = new URL(buildAuthorizationAttempt({ discovery, hostId, port: 54321, existing: { client_id: 'oaiapp_test', id_token: 'aaa.bbb.ccc', email: 'user@example.com' } }).url)
    check('認可URL(再認可): 発行済み client_id を使い、agent_name_hint を送らず、ヒントを付ける', again.searchParams.get('client_id') === 'oaiapp_test'
      && !again.searchParams.has('agent_name_hint') && again.searchParams.get('login_hint') === 'user@example.com' && again.searchParams.has('id_token_hint'))
    check('認可URLを表示するときは id_token_hint を伏せる', !redactAuthorizationUrl(again.toString()).includes('aaa.bbb.ccc'))

    const q = (value: Record<string, string>) => new URLSearchParams(value)
    check('コールバック: state 不一致は拒否', (() => { try { validateCallback(q({ state: 'x', code: 'c', client_id: 'oaiapp_1' }), first); return false } catch { return true } })())
    check('コールバック: 拒否(access_denied)なら交換しない', (() => { try { validateCallback(q({ state: first.state, error: 'access_denied' }), first); return false } catch (e) { return /拒否/.test((e as Error).message) } })())
    check('コールバック: 新規登録で client_id が無ければ未完了', (() => { try { validateCallback(q({ state: first.state, code: 'c' }), first); return false } catch { return true } })())
    check('コールバック: 新規登録の発行済み client_id を受け取る', validateCallback(q({ state: first.state, code: 'c', client_id: 'oaiapp_1' }), first).clientId === 'oaiapp_1')
    const re = buildAuthorizationAttempt({ discovery, hostId, port: 1455, existing: { client_id: 'oaiapp_1', email: '' } })
    check('コールバック: 再認可で別の client_id が返れば拒否', (() => { try { validateCallback(q({ state: re.state, code: 'c', client_id: 'oaiapp_2' }), re); return false } catch { return true } })())

    // IDトークン: 手元で作った鍵で署名し、JWKS を差し替えて検証する
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const jwk = { ...(publicKey.export({ format: 'jwk' }) as Record<string, string>), kid: 'k1', alg: 'RS256' }
    const makeToken = (claims: Record<string, unknown>, kid = 'k1') => {
      const header = base64url(Buffer.from(JSON.stringify({ alg: 'RS256', kid })))
      const payload = base64url(Buffer.from(JSON.stringify(claims)))
      const signer = createSign('RSA-SHA256')
      signer.update(`${header}.${payload}`)
      return `${header}.${payload}.${base64url(signer.sign(privateKey))}`
    }
    const now = new Date('2030-01-01T00:00:00Z')
    const nowSec = Math.floor(now.getTime() / 1000)
    const good = { iss: 'https://auth.openai.com', aud: 'oaiapp_1', sub: 'user-1', exp: nowSec + 3600, nonce: first.nonce, email: 'user@example.com' }
    const jwks = [jwk] as never
    const claims = await verifyIdToken(makeToken(good), { discovery, clientId: 'oaiapp_1', nonce: first.nonce, now, jwks })
    check('IDトークン: 署名・issuer・audience・期限・nonce が正しければ通す', claims.sub === 'user-1')
    const rejects = async (token: string, label: string) => {
      try { await verifyIdToken(token, { discovery, clientId: 'oaiapp_1', nonce: first.nonce, now, jwks }); check(label, false) } catch { check(label, true) }
    }
    await rejects(makeToken({ ...good, nonce: 'other' }), 'IDトークン: nonce 不一致は拒否')
    await rejects(makeToken({ ...good, aud: 'oaiapp_other' }), 'IDトークン: audience 不一致は拒否')
    await rejects(makeToken({ ...good, iss: 'https://evil.example.com' }), 'IDトークン: issuer 不一致は拒否')
    await rejects(makeToken({ ...good, exp: nowSec - 60 }), 'IDトークン: 期限切れは拒否')
    await rejects(makeToken(good).replace(/\.[^.]+$/, '.' + base64url(Buffer.from('bad'))), 'IDトークン: 署名改ざんは拒否')

    const record = buildCredentialRecord({
      label: 'default', clientId: 'oaiapp_1', hostId, claims, now,
      token: { access_token: 'at-1', refresh_token: 'rt-1', id_token: 'id', expires_in: 3600, scope: 'openid profile email offline_access resource.invoke' },
    })
    check('スコープ: chatgpt.tokens.use.direct が無ければプラン利用は無効', record.plan_usage_enabled === false)
    check('別アカウントでのサインインは既存登録を置き換えない', (() => { try { buildCredentialRecord({ label: 'default', clientId: 'oaiapp_1', hostId, claims: { ...claims, sub: 'user-2' }, token: { access_token: 'x' }, existing: record }); return false } catch { return true } })())

    const enabled: CredentialRecord = { ...record, scopes: [...record.scopes, 'chatgpt.tokens.use.direct'], plan_usage_enabled: true, saved_at: new Date('2020-01-01').toISOString() }
    saveCredential(dir, enabled)
    setActiveLabel(dir, 'default')
    let refreshForm: URLSearchParams | undefined
    const refreshed = await ensureFreshCredential(dir, 'default', {
      discovery,
      fetch: async (_url, init) => {
        refreshForm = new URLSearchParams(String(init?.body))
        return new Response(JSON.stringify({ access_token: 'at-2', refresh_token: 'rt-2', expires_in: 3600, scope: 'openid chatgpt.tokens.use.direct' }), { status: 200 })
      },
    })
    check('更新: 発行済み client_id・resource で更新し、回転後の refresh_token を保存', refreshForm?.get('client_id') === 'oaiapp_1' && refreshForm?.get('resource') === 'https://api.openai.com/v1'
      && refreshForm?.get('grant_type') === 'refresh_token' && refreshed.refresh_token === 'rt-2' && loadCredential(dir, 'default')?.access_token === 'at-2')
    saveCredential(dir, { ...refreshed, saved_at: new Date('2020-01-01').toISOString() })
    try {
      await ensureFreshCredential(dir, 'default', { discovery, fetch: async () => new Response(JSON.stringify({ error: 'refresh_token_reused' }), { status: 400 }) })
      check('更新: 使えない refresh_token なら再サインインを求める', false)
    } catch (error) {
      check('更新: 使えない refresh_token なら再サインインを求め、トークンを消す', error instanceof SignInRequiredError && !loadCredential(dir, 'default')?.refresh_token)
    }

    const disabled = createChatGptPlanAdapter({ env: { KATAZUKU_CHATGPT_DIR: dir, KATAZUKU_DISABLE_CHATGPT_SIWC: '1' } })
    check('明示的に無効化されていれば使わない', (await disabled.preflight(request(), async () => { throw new Error() })).failure === 'capability_missing')
    saveCredential(dir, { ...enabled, access_token: 'at-3', refresh_token: 'rt-3', saved_at: now.toISOString(), model: 'test-model' })
    let sent: Record<string, unknown> = {}
    const siwc = createChatGptPlanAdapter({
      env: { KATAZUKU_CHATGPT_DIR: dir },
      fetch: async (_url, init) => {
        sent = JSON.parse(String(init?.body))
        return sse([{ type: 'response.output_text.delta', delta: 'plan' }, { type: 'response.completed' }])
      },
    })
    const root = mkdtempSync(join(tmpdir(), 'katazuku-siwc-run-'))
    try {
      const result = await runAgent(request({ providerOrder: ['chatgpt-siwc'] }), { adapters: [siwc], artifactDir: root, now: () => now })
      check('ChatGPT プラン: Responses API(store:false / stream:true)で推論する', result.status === 'succeeded' && result.output === 'plan' && sent.store === false && sent.stream === true && sent.model === 'test-model', JSON.stringify(result))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
    let revokeForm: URLSearchParams | undefined
    const out = await signOut(dir, 'default', { discovery, fetch: async (_url, init) => { revokeForm = new URLSearchParams(String(init?.body)); return new Response('', { status: 200 }) } })
    const after = loadCredential(dir, 'default')
    check('サインアウト: refresh_token を失効させ、トークンだけ消して client_id は残す', out.revoked && revokeForm?.get('token_type_hint') === 'refresh_token'
      && !after?.access_token && !after?.refresh_token && after?.client_id === 'oaiapp_1')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

if (failed) { console.error(`\n${failed}件失敗`); process.exit(1) }
console.log('\nすべて通過')
