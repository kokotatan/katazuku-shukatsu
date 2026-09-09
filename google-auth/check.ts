import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { handleRequest, localRedirect } from './worker';
import { GOOGLE_SCOPES, GOOGLE_TOKEN_URL } from '../tools/google-workspace/scopes.mjs';

const env = { PUBLIC_ORIGIN: 'https://auth.example.com', GOOGLE_CLIENT_ID: '123-example.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'example-client-secret', STATE_SIGNING_SECRET: 'example-signing-key-'.repeat(4) };
const clock = () => 1_800_000_000_000;
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const localState = randomBytes(32).toString('base64url');
const localUrl = 'http://127.0.0.1:43125/google/callback';
const startInput = { code_challenge: challenge, state: localState, redirect_uri: localUrl };
const post = (path: string, value: unknown, headers: Record<string, string> = {}) => new Request(env.PUBLIC_ORIGIN + path,
  { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) });
let exchanges = 0;
const usedCodes = new Set<string>();
const fetcher: typeof fetch = async (request, init) => {
  assert.equal(String(request), GOOGLE_TOKEN_URL);
  assert.equal(init?.redirect, 'error');
  assert.ok(init?.signal);
  assert.ok(init?.body instanceof URLSearchParams);
  assert.equal(init.body.get('client_secret'), env.GOOGLE_CLIENT_SECRET);
  assert.equal(init.body.get('client_id'), env.GOOGLE_CLIENT_ID);
  exchanges++;
  if (init.body.get('grant_type') === 'authorization_code') {
    assert.equal(init.body.get('redirect_uri'), env.PUBLIC_ORIGIN + '/callback');
    assert.equal(init.body.get('code_verifier'), verifier);
    const code = init.body.get('code')!;
    if (usedCodes.has(code)) return Response.json({ error: 'invalid_grant' }, { status: 400 });
    usedCodes.add(code);
  }
  return Response.json({ access_token: 'example-access', refresh_token: 'example-refresh', token_type: 'Bearer', expires_in: 3600,
    scope: GOOGLE_SCOPES.join(' '), id_token: 'example-id-token' });
};
const deps = { fetcher, now: clock };

for (const bad of ['https://outside.example.com/google/callback', 'http://localhost:43125/google/callback',
  'http://127.0.0.1:43125/other', 'http://192.168.1.2:43125/google/callback',
  'http://127.0.0.1:80/google/callback', localUrl + '?next=outside', 'http://user@127.0.0.1:43125/google/callback']) {
  assert.throws(() => localRedirect(bad));
}
assert.equal(localRedirect(localUrl), localUrl);
assert.equal((await handleRequest(post('/start', startInput), { ...env, GOOGLE_CLIENT_SECRET: '' }, deps)).status, 503);
assert.equal((await handleRequest(post('/start', startInput, { Origin: 'https://outside.example.com' }), env, deps)).status, 403);
assert.equal((await handleRequest(post('/start', { ...startInput, code_challenge: 'plain-text' }), env, deps)).status, 400);
assert.equal((await handleRequest(post('/start', { ...startInput, redirect_uri: 'https://outside.example.com' }), env, deps)).status, 400);
const started = await handleRequest(post('/start', startInput), env, deps);
const start = await started.json() as { authorization_url: string };
const authorization = new URL(start.authorization_url);
assert.equal(authorization.origin, 'https://accounts.google.com');
assert.equal(authorization.searchParams.get('redirect_uri'), env.PUBLIC_ORIGIN + '/callback');
assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
assert.equal(authorization.searchParams.get('code_challenge'), challenge);
assert.deepEqual(authorization.searchParams.get('scope')!.split(' '), GOOGLE_SCOPES);
assert.equal(authorization.searchParams.get('include_granted_scopes'), 'false');
assert.ok(!GOOGLE_SCOPES.some(scope => ['drive', 'calendar', 'gmail.settings.basic'].some(name => scope === 'https://www.googleapis.com/auth/' + name)));
assert.equal(started.headers.get('Cache-Control'), 'no-store, private');
assert.equal(started.headers.get('Access-Control-Allow-Origin'), null);
const transaction = authorization.searchParams.get('state')!;
const callback = new URL(env.PUBLIC_ORIGIN + '/callback');
callback.search = new URLSearchParams({ state: transaction, code: 'example-code' }).toString();
const returned = await handleRequest(new Request(callback), env, deps);
assert.equal(returned.status, 303);
assert.equal(returned.headers.get('Referrer-Policy'), 'no-referrer');
const returnUrl = new URL(returned.headers.get('Location')!);
assert.equal(returnUrl.origin, 'http://127.0.0.1:43125');
assert.equal(returnUrl.searchParams.get('state'), localState);
assert.equal(returnUrl.searchParams.get('code'), 'example-code');
assert.equal(exchanges, 0);
const tokenInput = { client_id: env.GOOGLE_CLIENT_ID, grant_type: 'authorization_code', transaction, code: 'example-code', code_verifier: verifier };
assert.equal((await handleRequest(post('/token', { ...tokenInput, code_verifier: 'z'.repeat(43) }), env, deps)).status, 400);
assert.equal((await handleRequest(post('/token', { ...tokenInput, client_id: 'different-client' }), env, deps)).status, 400);
assert.equal((await handleRequest(post('/token', { ...tokenInput, transaction: transaction.slice(0, -2) + 'xx' }), env, deps)).status, 400);
assert.equal((await handleRequest(post('/token', tokenInput), env, { ...deps, now: () => clock() + 601_000 })).status, 400);
assert.equal(exchanges, 0);
const exchanged = await handleRequest(post('/token', tokenInput), env, deps);
const tokens = await exchanged.json() as Record<string, unknown>;
assert.equal(tokens.access_token, 'example-access');
assert.equal(tokens.refresh_token, 'example-refresh');
assert.equal(tokens.id_token, undefined);
assert.equal(JSON.stringify(tokens).includes(env.GOOGLE_CLIENT_SECRET), false);
assert.equal((await handleRequest(post('/token', tokenInput), env, deps)).status, 400);
const refresh = new Request(env.PUBLIC_ORIGIN + '/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, grant_type: 'refresh_token', refresh_token: 'example-refresh' }) });
assert.equal((await handleRequest(refresh, env, deps)).status, 200);
const denied = new URL(callback);
denied.search = new URLSearchParams({ state: transaction, error: 'access_denied', error_description: 'private-example' }).toString();
const denyResult = await handleRequest(new Request(denied), env, deps);
assert.equal(denyResult.status, 303);
assert.equal(denyResult.headers.get('Location')!.includes('private-example'), false);
const overflow = new Request(env.PUBLIC_ORIGIN + '/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(65_537) });
assert.equal((await handleRequest(overflow, env, deps)).status, 413);
assert.equal((await handleRequest(post('/token', { ...tokenInput, grant_type: 'password' }), env, deps)).status, 400);
assert.equal((await handleRequest(post('/token', { client_id: env.GOOGLE_CLIENT_ID, grant_type: 'refresh_token', refresh_token: 'example-refresh' }), env,
  { now: clock, fetcher: async () => { throw new Error('example-private-network-detail'); } })).status, 503);
console.log('共通Google認証: PKCE・署名state・期限・宛先制限・再利用・拒否・秘密非出力・本文上限を検証しました。');
