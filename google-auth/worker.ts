import { GOOGLE_SCOPES, GOOGLE_TOKEN_URL, GOOGLE_AUTHORIZE_URL, normalizedScopes } from '../tools/google-workspace/scopes.mjs';

const encoder = new TextEncoder();
const maxBody = 65_536;
const stateLifetime = 10 * 60;
const opaquePattern = /^[A-Za-z0-9_-]{43}$/;
const securityHeaders = {
  'Cache-Control': 'no-store, private',
  'Pragma': 'no-cache',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
};

class RequestError extends Error {
  constructor(readonly reason: string, readonly status = 400) { super(reason); }
}

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: securityHeaders });
}

function redirect(target: URL) {
  return new Response(null, { status: 303, headers: { ...securityHeaders, Location: target.href } });
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RequestError('invalid_request');
  return value as Record<string, unknown>;
}

function string(value: unknown, min = 1, max = 8192): string {
  if (typeof value !== 'string' || value.length < min || value.length > max || /[\u0000-\u001f]/.test(value)) throw new RequestError('invalid_request');
  return value;
}

export function localRedirect(value: unknown): string {
  const url = new URL(string(value, 1, 200));
  // 外部URL、LAN、名前解決、任意のローカルパスへのリダイレクトを認めない。
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.search || url.hash
    || url.pathname !== '/google/callback' || !/^\d+$/.test(url.port) || Number(url.port) < 1024 || Number(url.port) > 65535) {
    throw new RequestError('invalid_redirect');
  }
  return url.href;
}

function encode(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function decode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new RequestError('invalid_state');
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
}

async function key(secret: string) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function signState(value: unknown, secret: string) {
  const payload = encode(encoder.encode(JSON.stringify(value)));
  const signature = await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(payload));
  return `${payload}.${encode(new Uint8Array(signature))}`;
}

async function stateClaims(value: string, secret: string, now: number) {
  const [payload, signature, extra] = value.split('.');
  if (!payload || !signature || extra || value.length > 2048) throw new RequestError('invalid_state');
  if (!await crypto.subtle.verify('HMAC', await key(secret), decode(signature), encoder.encode(payload))) throw new RequestError('invalid_state');
  const claims = record(JSON.parse(new TextDecoder().decode(decode(payload))));
  if (claims.v !== 1 || typeof claims.expires !== 'number' || claims.expires <= now || claims.expires > now + stateLifetime
    || !opaquePattern.test(string(claims.challenge)) || !opaquePattern.test(string(claims.local_state))) throw new RequestError('invalid_state');
  return { redirect: localRedirect(claims.redirect), challenge: string(claims.challenge), localState: string(claims.local_state) };
}

async function boundedText(message: Request | Response) {
  if (Number(message.headers.get('Content-Length')) > maxBody) throw new RequestError('request_too_large', 413);
  if (!message.body) return '';
  const reader = message.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBody) { await reader.cancel(); throw new RequestError('request_too_large', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
}

async function parameters(request: Request): Promise<Record<string, unknown>> {
  const type = request.headers.get('Content-Type')?.split(';')[0];
  const text = await boundedText(request);
  if (type === 'application/json') return record(JSON.parse(text));
  if (type === 'application/x-www-form-urlencoded') {
    const values: Record<string, string> = {};
    for (const [name, value] of new URLSearchParams(text)) {
      if (Object.hasOwn(values, name)) throw new RequestError('duplicate_parameter');
      Object.defineProperty(values, name, { value, enumerable: true });
    }
    return values;
  }
  throw new RequestError('unsupported_media_type', 415);
}

type Dependencies = { fetcher?: typeof fetch; now?: () => number };

export async function handleRequest(request: Request, env: OAuthEnv, dependencies: Dependencies = {}): Promise<Response> {
  const fetcher = dependencies.fetcher ?? fetch;
  const now = Math.floor((dependencies.now?.() ?? Date.now()) / 1000);
  try {
    const url = new URL(request.url);
    if (url.origin !== env.PUBLIC_ORIGIN || url.protocol !== 'https:') return json({ error: 'invalid_origin' }, 400);
    const callback = `${env.PUBLIC_ORIGIN}/callback`;
    const configured = /^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(env.GOOGLE_CLIENT_ID)
      && !!env.GOOGLE_CLIENT_SECRET && env.STATE_SIGNING_SECRET?.length >= 43;
    if (request.method === 'GET' && url.pathname === '/metadata') {
      return json({ name: 'katazuku', configured, client_id: configured ? env.GOOGLE_CLIENT_ID : null,
        authorization_endpoint: `${env.PUBLIC_ORIGIN}/start`, token_endpoint: `${env.PUBLIC_ORIGIN}/token`,
        callback, scopes: GOOGLE_SCOPES, verification: 'not_asserted' });
    }
    if (!configured) return json({ error: 'not_configured' }, 503);
    if (request.method === 'GET' && url.pathname === '/callback') {
      const transaction = string(url.searchParams.get('state'), 1, 2048);
      const claims = await stateClaims(transaction, env.STATE_SIGNING_SECRET, now);
      const destination = new URL(claims.redirect);
      destination.searchParams.set('state', claims.localState);
      if (url.searchParams.has('error')) {
        destination.searchParams.set('error', 'access_denied');
      } else {
        destination.searchParams.set('code', string(url.searchParams.get('code')));
        destination.searchParams.set('transaction', transaction);
      }
      return redirect(destination);
    }
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    // PCのNodeプロセスから呼ぶ。別サイトのブラウザJS・フォームからは使わせない。
    const origin = request.headers.get('Origin');
    if (origin && origin !== env.PUBLIC_ORIGIN) return json({ error: 'cross_origin_denied' }, 403);
    const input = await parameters(request);
    if (url.pathname === '/start') {
      const challenge = string(input.code_challenge);
      const localState = string(input.state);
      if (!opaquePattern.test(challenge) || !opaquePattern.test(localState)) throw new RequestError('invalid_pkce');
      const transaction = await signState({ v: 1, challenge, local_state: localState, redirect: localRedirect(input.redirect_uri), expires: now + stateLifetime }, env.STATE_SIGNING_SECRET);
      const target = new URL(GOOGLE_AUTHORIZE_URL);
      target.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: callback, response_type: 'code',
        scope: GOOGLE_SCOPES.join(' '), access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false',
        state: transaction, code_challenge: challenge, code_challenge_method: 'S256' }).toString();
      return json({ authorization_url: target.href, expires_in: stateLifetime, client_id: env.GOOGLE_CLIENT_ID });
    }
    if (url.pathname !== '/token') return json({ error: 'not_found' }, 404);
    if (input.client_id !== env.GOOGLE_CLIENT_ID) throw new RequestError('invalid_client');
    const fields = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET });
    if (input.grant_type === 'authorization_code') {
      const claims = await stateClaims(string(input.transaction, 1, 2048), env.STATE_SIGNING_SECRET, now);
      const verifier = string(input.code_verifier, 43, 128);
      if (!/^[A-Za-z0-9._~-]+$/.test(verifier)) throw new RequestError('invalid_pkce');
      const challenge = encode(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier))));
      // challengeは公開値。秘密の署名は上のWeb Crypto verifyで比較する。
      if (challenge !== claims.challenge) throw new RequestError('invalid_pkce');
      fields.set('grant_type', 'authorization_code');
      fields.set('code', string(input.code));
      fields.set('code_verifier', verifier);
      fields.set('redirect_uri', callback);
    } else if (input.grant_type === 'refresh_token') {
      fields.set('grant_type', 'refresh_token');
      fields.set('refresh_token', string(input.refresh_token));
    } else throw new RequestError('unsupported_grant_type');
    let upstream: Response;
    try { upstream = await fetcher(GOOGLE_TOKEN_URL, { method: 'POST', body: fields, redirect: 'error', signal: AbortSignal.timeout(20_000) }); }
    catch { throw new RequestError('oauth_unavailable', 503); }
    let token: Record<string, unknown>;
    try { token = record(JSON.parse(await boundedText(upstream))); }
    catch { throw new RequestError('invalid_oauth_response', 502); }
    if (!upstream.ok) {
      const error = ['invalid_grant', 'invalid_client', 'temporarily_unavailable'].includes(String(token.error)) ? token.error : 'oauth_exchange_failed';
      return json({ error }, upstream.status >= 500 ? 502 : 400);
    }
    if (typeof token.access_token !== 'string' || !token.access_token || token.token_type !== 'Bearer'
      || typeof token.expires_in !== 'number' || token.expires_in <= 0 || token.expires_in > 86_400) throw new RequestError('invalid_oauth_response', 502);
    const scopes = normalizedScopes(token.scope);
    if (scopes.some(scope => !GOOGLE_SCOPES.includes(scope))) throw new RequestError('unexpected_scope', 502);
    // IDトークンやGoogleのエラー本文、秘密鍵をそのまま返さない。永続ストレージは使わない。
    return json({ access_token: token.access_token, token_type: 'Bearer', expires_in: token.expires_in,
      ...(scopes.length ? { scope: scopes.join(' ') } : {}),
      ...(typeof token.refresh_token === 'string' && token.refresh_token ? { refresh_token: token.refresh_token } : {}) });
  } catch (error) {
    // 認可コード・トークン・URLをログへ出さない。
    return json({ error: error instanceof RequestError ? error.reason : 'invalid_request' }, error instanceof RequestError ? error.status : 400);
  }
}

export default { fetch(request, env) { return handleRequest(request, env); } } satisfies ExportedHandler<OAuthEnv>;
