import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { mkdtemp, readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { handleRequest } from './worker';
import { startConnection } from '../tools/google-workspace/connection.mjs';
import { GOOGLE_SCOPES, GOOGLE_USERINFO_URL, GOOGLE_TOKEN_URL } from '../tools/google-workspace/scopes.mjs';

const parent = resolve(tmpdir());
const root = await mkdtemp(join(parent, 'katazuku-google-connect-check-'));
const env = { PUBLIC_ORIGIN: 'https://auth.example.com', GOOGLE_CLIENT_ID: '123-example.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'example-client-secret', STATE_SIGNING_SECRET: 'example-signing-key-'.repeat(4) };
const account = 'person@example.com';
let instant = Date.now();
let identity = account;
let expectedChallenge = '';
let exchanges = 0;
const googleFetch: typeof fetch = async (request, init) => {
  const url = String(request);
  assert.equal(init?.redirect, url === GOOGLE_TOKEN_URL ? 'manual' : 'error');
  if (url === GOOGLE_TOKEN_URL) {
    exchanges++;
    const fields = init?.body as URLSearchParams;
    assert.equal(fields.get('client_secret'), env.GOOGLE_CLIENT_SECRET);
    if (fields.get('grant_type') === 'authorization_code') {
      assert.equal(createHash('sha256').update(fields.get('code_verifier')!).digest('base64url'), expectedChallenge);
    }
    return Response.json({ access_token: 'example-access', refresh_token: 'example-refresh', token_type: 'Bearer', expires_in: 3600, scope: GOOGLE_SCOPES.join(' ') });
  }
  if (url === GOOGLE_USERINFO_URL) return Response.json({ email: identity, verified_email: true });
  assert.ok(['https://gmail.googleapis.com/', 'https://www.googleapis.com/calendar/', 'https://www.googleapis.com/drive/', 'https://sheets.googleapis.com/'].some(prefix => url.startsWith(prefix)));
  return Response.json({});
};
const fetcher: typeof fetch = async (request, init) => {
  const url = typeof request === 'string' ? request : request instanceof URL ? request.href : request.url;
  if (url.startsWith(env.PUBLIC_ORIGIN)) return handleRequest(new Request(url, init), env, { fetcher: googleFetch, now: () => instant });
  return googleFetch(request, init);
};
const sessions: Awaited<ReturnType<typeof startConnection>>[] = [];
async function open(directory: string, replace = false) {
  const session = await startConnection({ account, broker: env.PUBLIC_ORIGIN, credentialsDirectory: directory, replace,
    fetcher, now: () => instant, spreadsheetId: 'example-spreadsheet' });
  sessions.push(session);
  return session;
}
async function post(session: Awaited<ReturnType<typeof startConnection>>, path: string, overrides = {}) {
  return fetch(session.url + '/api/' + path, { method: 'POST', headers: { Origin: session.url, 'X-Katazuku-CSRF': session.csrf, 'Content-Type': 'application/json', ...overrides }, body: '{}' });
}
async function authorize(session: Awaited<ReturnType<typeof startConnection>>) {
  const response = await post(session, 'connect');
  assert.equal(response.status, 200);
  const data = await response.json() as { authorizationUrl: string };
  const google = new URL(data.authorizationUrl);
  expectedChallenge = google.searchParams.get('code_challenge')!;
  const url = new URL(env.PUBLIC_ORIGIN + '/callback');
  url.search = new URLSearchParams({ state: google.searchParams.get('state')!, code: 'example-code-' + exchanges }).toString();
  const returned = await handleRequest(new Request(url), env, { fetcher: googleFetch, now: () => instant });
  return returned.headers.get('Location')!;
}
try {
  const directory = join(root, 'normal');
  const session = await open(directory);
  const page = await fetch(session.url + '/');
  assert.equal(page.headers.get('Cache-Control'), 'no-store');
  assert.match(await page.text(), /Googleとつなぐ/);
  const foreignHost = await new Promise<number>((resolve, reject) => {
    const request = httpRequest(session.url + '/', { headers: { Host: 'outside.example.com' } }, response => {
      response.resume(); response.on('end', () => resolve(response.statusCode!));
    });
    request.on('error', reject); request.end();
  });
  assert.equal(foreignHost, 400);
  assert.equal((await post(session, 'connect', { Origin: 'https://outside.example.com' })).status, 403);
  assert.equal((await post(session, 'connect', { 'X-Katazuku-CSRF': 'wrong' })).status, 403);
  assert.equal(exchanges, 0);
  let callback = await authorize(session);
  assert.equal((await post(session, 'connect')).status, 409);
  const wrongState = new URL(callback);
  wrongState.searchParams.set('state', 'wrong');
  assert.equal((await fetch(wrongState)).status, 400);
  assert.equal(exchanges, 0);
  identity = 'someone@example.com';
  await fetch(callback);
  assert.equal(session.getState().status, 'failed');
  await assert.rejects(() => readFile(join(directory, account + '.json')));
  identity = account;
  callback = await authorize(session);
  await fetch(callback);
  assert.equal(session.getState().status, 'connected');
  const savedText = await readFile(join(directory, account + '.json'), 'utf8');
  const saved = JSON.parse(savedText);
  assert.equal(saved.token_uri, env.PUBLIC_ORIGIN + '/token');
  assert.equal(saved.client_secret, '');
  assert.equal(saved.refresh_token, 'example-refresh');
  assert.equal(savedText.includes(env.GOOGLE_CLIENT_SECRET), false);
  const countBeforeReplay = exchanges;
  assert.equal((await fetch(callback)).status, 400);
  assert.equal(exchanges, countBeforeReplay);
  assert.equal((await post(session, 'check')).status, 200);
  const status = await (await fetch(session.url + '/api/status')).text();
  assert.doesNotMatch(status, /example-(access|refresh|client-secret)/);
  assert.equal(JSON.parse(status).diagnostic.services.filter((service: { state: string }) => service.state === 'connected').length, 4);

  const existingDir = join(root, 'existing');
  await mkdir(existingDir);
  const original = JSON.stringify({ client_id: '456-other.apps.googleusercontent.com', refresh_token: 'example-old-refresh' });
  const existingFile = join(existingDir, account + '.json');
  await writeFile(existingFile, original);
  const preserve = await open(existingDir);
  await fetch(await authorize(preserve));
  assert.equal(preserve.getState().status, 'failed');
  assert.equal(await readFile(existingFile, 'utf8'), original);
  const replacing = await open(existingDir, true);
  await fetch(await authorize(replacing));
  assert.equal(replacing.getState().status, 'connected');
  const backups = await readdir(join(existingDir, '.katazuku-backups'));
  assert.equal(backups.length, 1);
  assert.equal(await readFile(join(existingDir, '.katazuku-backups', backups[0]), 'utf8'), original);

  const conflictDir = join(root, 'conflict');
  await mkdir(conflictDir);
  const conflicting = await open(conflictDir);
  const conflictCallback = await authorize(conflicting);
  await writeFile(join(conflictDir, account + '.json'), original);
  await fetch(conflictCallback);
  assert.equal(conflicting.getState().status, 'failed');
  assert.equal(await readFile(join(conflictDir, account + '.json'), 'utf8'), original);
  const expiring = await open(join(root, 'expiry'));
  await authorize(expiring);
  instant += 601_000;
  const expired = await (await fetch(expiring.url + '/api/status')).json() as { status: string };
  assert.equal(expired.status, 'expired');
  assert.equal((await post(expiring, 'connect')).status, 200);
  console.log('PCのGoogle接続: 共通認証との往復・本人照合・保存・既存接続の保護・4 API診断・CSRF・期限を検証しました。');
} finally {
  for (const session of sessions) await session.close();
  if (dirname(resolve(root)) !== parent || !basename(root).startsWith('katazuku-google-connect-check-')) throw new Error('試験ディレクトリの範囲が不正です。');
  await rm(root, { recursive: true, force: true });
}
