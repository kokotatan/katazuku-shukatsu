import { createServer } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { credentialPath, inspectCredential, checkOnline } from './doctor.mjs';
import { DEFAULT_BROKER_ORIGIN, GOOGLE_SCOPES, GOOGLE_USERINFO_URL, normalizedScopes } from './scopes.mjs';

export { DEFAULT_BROKER_ORIGIN } from './scopes.mjs';
class ConnectionError extends Error {}
const safeMessage = error => error instanceof ConnectionError ? error.message : 'Google接続の処理に失敗しました。保存先と接続状態を確認してください。';
const token = () => randomBytes(32).toString('base64url');
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" };
const equal = (left, right) => typeof left === 'string' && typeof right === 'string'
  && Buffer.byteLength(left) === Buffer.byteLength(right) && timingSafeEqual(Buffer.from(left), Buffer.from(right));

export function brokerOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new ConnectionError('認証サーバーはHTTPSのオリジンを指定してください。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new ConnectionError('認証サーバーはHTTPSのオリジンを指定してください。');
  return url.origin;
}

async function limitedJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new ConnectionError('空の応答です。');
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 65_536) { await reader.cancel(); throw new ConnectionError('応答が大きすぎます。'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ConnectionError('応答の形式が不正です。');
  return data;
}

async function api(fetcher, url, options = {}) {
  let response;
  let data;
  try {
    response = await fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(20_000) });
    data = await limitedJson(response);
  } catch { throw new ConnectionError('認証サービスの応答を読み取れませんでした。もう一度試してください。'); }
  if (!response.ok) {
    const known = { not_configured: '認証サービスは準備中です。', invalid_grant: '認証が失効しました。接続をやり直してください。',
      invalid_pkce: '認証の照合に失敗しました。', invalid_state: '認証が期限切れか、この画面で開始した認証ではありません。' };
    throw new ConnectionError(known[data.error] || `Google接続の通信に失敗しました（HTTP ${response.status}）。`);
  }
  return data;
}

async function readExisting(path) {
  try { return await readFile(path, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw new ConnectionError('保存済み接続を読めません。'); }
}

export async function startConnection({ account, broker = DEFAULT_BROKER_ORIGIN, credentialsDirectory,
  replace = false, port = 0, fetcher = fetch, now = Date.now, spreadsheetId, recordDemo = false } = {}) {
  const destination = credentialPath(account, credentialsDirectory);
  const origin = brokerOrigin(broker);
  const csrf = token();
  let publicUrl;
  let pending;
  let state = { status: 'ready', message: 'Googleアカウントと権限を確認して接続します。' };
  let stored;
  let busy = false;
  const initialCredential = await readExisting(destination);
  let previous;
  try { previous = initialCredential ? JSON.parse(initialCredential) : null; }
  catch { throw new ConnectionError('保存済み接続の形式が不正です。上書きせず停止しました。'); }
  let ui = await readFile(new URL('./connect.html', import.meta.url), 'utf8');
  if (recordDemo) ui = ui.replace('</header>', `</header><section><h2>審査用の実画面を録画</h2><p>Chromeのウィンドウを選んでください。Googleのアドレスバーを含めて録画します。このタブは録画停止まで開いたままにしてください。動画はこのPCに保存し、確認後に審査へ提出します。</p><button id="record-start">実画面の録画を開始</button> <button id="record-stop" disabled>録画を停止</button><p id="record-status" role="status">録画していません。</p><a id="record-download" hidden>動画をPCに保存</a></section><script type="module" src="/record-demo.mjs"></script>`);
  const script = await readFile(new URL('./connect-ui.mjs', import.meta.url), 'utf8');
  const recorder = recordDemo ? await readFile(new URL('./record-demo.mjs', import.meta.url), 'utf8') : '';
  const style = await readFile(new URL('./connect.css', import.meta.url), 'utf8');
  const bootstrap = () => ({ account, broker: origin, csrf, replace, hasExistingConnection: initialCredential !== null, scopes: GOOGLE_SCOPES });
  const send = (response, status, body, type = 'application/json; charset=utf-8') => {
    response.writeHead(status, { ...headers, 'Content-Type': type });
    response.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
  };
  const server = createServer(async (request, response) => {
    try {
      if (!publicUrl || request.headers.host !== new URL(publicUrl).host || (request.url?.length || 0) > 8192) return send(response, 400, { error: '接続先が不正です。' });
      const url = new URL(request.url, publicUrl);
      if (url.origin !== publicUrl) return send(response, 400, { error: '接続先が不正です。' });
      if (request.method === 'GET') {
        if (url.pathname === '/') return send(response, 200, ui.replace('BOOTSTRAP_JSON', JSON.stringify(bootstrap()).replace(/</g, '\\u003c')), 'text/html; charset=utf-8');
        if (url.pathname === '/connect-ui.mjs') return send(response, 200, script, 'text/javascript; charset=utf-8');
        if (url.pathname === '/record-demo.mjs' && recordDemo) return send(response, 200, recorder, 'text/javascript; charset=utf-8');
        if (url.pathname === '/connect.css') return send(response, 200, style, 'text/css; charset=utf-8');
        if (url.pathname === '/api/status') {
          if (pending && pending.expires < now() && !busy) {
            pending = undefined;
            state = { status: 'expired', message: 'Google認証の有効期限が切れました。接続をやり直してください。' };
          }
          return send(response, 200, state);
        }
        if (url.pathname !== '/google/callback') return send(response, 404, { error: 'ページがありません。' });
        if (!pending || !equal(url.searchParams.get('state'), pending.state) || pending.expires < now() || busy) {
          return send(response, 400, 'この画面で開始した有効な認証ではありません。元のkatazuku画面に戻ってください。', 'text/plain; charset=utf-8');
        }
        const auth = pending;
        pending = undefined; // 二重コールバックやリロードで再実行しない。
        if (url.searchParams.has('error')) {
          state = { status: 'cancelled', message: 'Google接続をキャンセルしました。保存済みの接続は変更していません。' };
        } else {
          busy = true;
          try {
            const code = url.searchParams.get('code');
            const transaction = url.searchParams.get('transaction');
            if (!code || !transaction || code.length > 8192 || transaction.length > 2048) throw new ConnectionError('認証結果が不正です。');
            const result = await api(fetcher, origin + '/token', { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ grant_type: 'authorization_code', code, transaction, code_verifier: auth.verifier, client_id: auth.clientId }) });
            const scopes = normalizedScopes(result.scope);
            if (typeof result.access_token !== 'string' || typeof result.refresh_token !== 'string'
              || !result.refresh_token || result.token_type !== 'Bearer' || !Number.isFinite(result.expires_in) || result.expires_in <= 0
              || result.expires_in > 86_400 || scopes.length === 0 || scopes.some(scope => !GOOGLE_SCOPES.includes(scope))) throw new ConnectionError('認証結果に必要な情報がありません。');
            const identity = await api(fetcher, GOOGLE_USERINFO_URL, { headers: { Authorization: `Bearer ${result.access_token}` } });
            if (identity.verified_email !== true || typeof identity.email !== 'string' || identity.email.toLowerCase() !== account.toLowerCase()) {
              throw new ConnectionError('指定したアカウントとGoogleで選んだアカウントが一致しません。接続を保存しませんでした。');
            }
            if (previous?.client_id && previous.client_id !== auth.clientId && !replace) throw new ConnectionError('別のGoogle接続が保存されています。置き換える場合は --replace を指定して起動してください。');
            if (await readExisting(destination) !== initialCredential) throw new ConnectionError('認証中に保存済みの接続が変更されました。上書きせず停止しました。');
            stored = { token: result.access_token, refresh_token: result.refresh_token, token_uri: origin + '/token', client_id: auth.clientId,
              client_secret: '', scopes, expiry: new Date(now() + result.expires_in * 1000).toISOString() };
            await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
            if (initialCredential) {
              const backups = join(dirname(destination), '.katazuku-backups');
              await mkdir(backups, { recursive: true, mode: 0o700 });
              await writeFile(join(backups, `${now()}-${token()}.json`), initialCredential, { flag: 'wx', mode: 0o600 });
            }
            const temporary = destination + '.' + token() + '.tmp';
            try { await writeFile(temporary, JSON.stringify(stored, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); await rename(temporary, destination); }
            finally { await unlink(temporary).catch(() => {}); }
            state = { status: 'connected', message: 'Google接続をこのPCに保存しました。続けて接続を確認できます。',
              account, capabilities: inspectCredential(stored).capabilities, missingScopes: GOOGLE_SCOPES.filter(scope => !scopes.includes(scope)) };
          } catch (error) { state = { status: 'failed', message: safeMessage(error) }; }
          finally { busy = false; }
        }
        response.writeHead(303, { ...headers, Location: publicUrl + '/' });
        return response.end();
      }
      if (request.method !== 'POST' || request.headers.origin !== publicUrl || !equal(request.headers['x-katazuku-csrf'], csrf)) {
        return send(response, 403, { error: 'このPCの接続画面から操作してください。' });
      }
      if (request.headers['content-type']?.split(';')[0] !== 'application/json') return send(response, 415, { error: '送信形式が不正です。' });
      let size = 0;
      for await (const chunk of request) { size += chunk.length; if (size > 1024) return send(response, 413, { error: '要求が大きすぎます。' }); }
      if (busy) return send(response, 409, { error: '処理中です。しばらく待ってください。' });
      if (url.pathname === '/api/connect') {
        if (state.status === 'connected') return send(response, 409, { error: 'この画面では接続済みです。' });
        if (pending && pending.expires >= now()) return send(response, 409, { error: 'Googleの認証画面で確認を続けてください。' });
        busy = true;
        try {
          const verifier = token();
          const localState = token();
          const challenge = createHash('sha256').update(verifier).digest('base64url');
          const metadata = await api(fetcher, origin + '/metadata');
          if (!metadata.configured || typeof metadata.client_id !== 'string' || !/^\d+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(metadata.client_id)
            || metadata.token_endpoint !== origin + '/token' || JSON.stringify(metadata.scopes) !== JSON.stringify(GOOGLE_SCOPES)) throw new ConnectionError('認証サービスの設定を確認できません。');
          const started = await api(fetcher, origin + '/start', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ state: localState, code_challenge: challenge, redirect_uri: publicUrl + '/google/callback' }) });
          const target = new URL(started.authorization_url);
          if (target.origin !== 'https://accounts.google.com' || target.pathname !== '/o/oauth2/v2/auth'
            || target.searchParams.get('client_id') !== metadata.client_id || target.searchParams.get('code_challenge') !== challenge
            || target.searchParams.get('code_challenge_method') !== 'S256' || target.searchParams.get('redirect_uri') !== origin + '/callback'
            || target.searchParams.get('scope') !== GOOGLE_SCOPES.join(' ') || !target.searchParams.get('state')) throw new ConnectionError('Googleへの接続URLを確認できません。');
          if (recordDemo) target.searchParams.set('hl', 'en');
          pending = { verifier, state: localState, clientId: metadata.client_id, expires: now() + 600_000 };
          state = { status: 'authorizing', message: 'Googleの画面でアカウントと権限を確認してください。' };
          return send(response, 200, { authorizationUrl: target.href });
        } finally { busy = false; }
      }
      if (url.pathname === '/api/check') {
        if (!stored || state.status !== 'connected') return send(response, 409, { error: '先にGoogleへ接続してください。' });
        busy = true;
        try {
          const diagnostic = await checkOnline(stored, account, { fetcher, spreadsheetId, trustedTokenEndpoint: origin + '/token' });
          state = { ...state, diagnostic };
          return send(response, 200, diagnostic);
        } finally { busy = false; }
      }
      return send(response, 404, { error: '操作がありません。' });
    } catch (error) {
      const message = safeMessage(error);
      state = { status: 'failed', message };
      return send(response, 400, { error: message });
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  publicUrl = 'http://127.0.0.1:' + server.address().port;
  return { url: publicUrl, csrf, getState: () => state, close: () => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections();
  }) };
}
