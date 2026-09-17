import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_BROKER_ORIGIN, GOOGLE_TOKEN_URL } from './scopes.mjs';

const prefix = 'https://www.googleapis.com/auth/';
const hierarchy = {
  'gmail.modify': ['gmail.readonly', 'gmail.send', 'gmail.compose', 'gmail.labels'],
  drive: ['drive.readonly', 'drive.file'],
  calendar: ['calendar.readonly', 'calendar.events'],
  spreadsheets: ['spreadsheets.readonly'],
};

export function credentialPath(account, directory = join(homedir(), '.google_workspace_mcp', 'credentials')) {
  if (typeof account !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._+%-]*@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(account)
    || account.length > 254 || account.includes('..')) throw new Error('Googleアカウントのメールアドレスを指定してください。');
  return join(resolve(directory), `${account}.json`);
}

export function inspectCredential(stored) {
  const scopes = [...new Set((Array.isArray(stored.scopes) ? stored.scopes : []).filter(s => typeof s === 'string'
    && /^(openid|https:\/\/www\.googleapis\.com\/auth\/[a-zA-Z0-9._-]+)$/.test(s)))].sort();
  const granted = new Set(scopes.map(s => s.replace(prefix, '')));
  for (const [broad, narrow] of Object.entries(hierarchy)) if (granted.has(broad)) narrow.forEach(s => granted.add(s));
  return {
    clientConfigured: typeof stored.client_id === 'string' && /^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(stored.client_id),
    projectNumber: typeof stored.client_id === 'string' ? stored.client_id.match(/^(\d+)-/)?.[1] ?? null : null,
    refreshAvailable: typeof stored.refresh_token === 'string' && stored.refresh_token.length > 0,
    scopes,
    capabilities: Object.fromEntries(['gmail.readonly', 'gmail.modify', 'gmail.compose', 'gmail.send', 'gmail.settings.basic',
      'calendar.readonly', 'calendar.events', 'drive.readonly', 'drive.file', 'spreadsheets.readonly', 'spreadsheets']
      .map(scope => [scope, granted.has(scope)])),
    // トークンの存在とGoogleによるアプリ審査は別。API応答から審査済みとは判断しない。
    verification: 'not_checked',
  };
}

async function requestJson(fetcher, url, options = {}) {
  const response = await fetcher(url, { ...options, signal: AbortSignal.timeout(20_000), redirect: 'error' });
  let data;
  try { data = await response.json(); } catch { data = {}; }
  return { ok: response.ok, status: response.status, data };
}

export function tokenEndpoint(stored, trustedTokenEndpoint) {
  const selected = trustedTokenEndpoint ?? (stored.token_uri === DEFAULT_BROKER_ORIGIN + '/token'
    ? DEFAULT_BROKER_ORIGIN + '/token' : GOOGLE_TOKEN_URL);
  try {
    const url = new URL(selected);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/token'
      || (stored.token_uri && stored.token_uri !== selected)) return null;
    return selected;
  } catch { return null; }
}

export async function checkOnline(stored, account, { fetcher = fetch, spreadsheetId, trustedTokenEndpoint } = {}) {
  const metadata = inspectCredential(stored);
  if (!metadata.clientConfigured || !metadata.refreshAvailable) return { ok: false, reason: 'authentication_required' };
  // 資格情報ファイル内のtoken_uriは信用しない。資格情報を送信する先を固定する。
  // 中継を使う場合も、呼び出し元が明示した信頼先と一致する時だけ認証情報を送る。
  const endpoint = tokenEndpoint(stored, trustedTokenEndpoint);
  if (!endpoint) return { ok: false, reason: 'unexpected_token_endpoint' };
  if (spreadsheetId && !/^[a-zA-Z0-9_-]{10,200}$/.test(spreadsheetId)) return { ok: false, reason: 'invalid_spreadsheet_id' };
  try {
    const fields = { client_id: stored.client_id, refresh_token: stored.refresh_token, grant_type: 'refresh_token' };
    if (stored.client_secret) fields.client_secret = stored.client_secret;
    const token = await requestJson(fetcher, endpoint, {
      method: 'POST', body: new URLSearchParams(fields),
    });
    if (!token.ok || typeof token.data.access_token !== 'string' || !token.data.access_token) {
      return { ok: false, reason: token.data.error === 'invalid_grant' ? 'reauthentication_required' : 'token_refresh_failed', http: token.status };
    }
    const headers = { Authorization: `Bearer ${token.data.access_token}` };
    const identity = await requestJson(fetcher, 'https://www.googleapis.com/oauth2/v2/userinfo', { headers });
    if (!identity.ok) return { ok: false, reason: 'identity_check_failed', http: identity.status };
    if (identity.data.verified_email !== true || typeof identity.data.email !== 'string'
      || identity.data.email.toLowerCase() !== account.toLowerCase()) {
      return { ok: false, reason: 'account_mismatch' };
    }
    const checks = [
      ['gmail', 'gmail.readonly', 'https://gmail.googleapis.com/gmail/v1/users/me/profile'],
      ['calendar', 'calendar.readonly', 'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1&fields=items(id)'],
      ['drive', 'drive.readonly', 'https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id)'],
      ['sheets', 'spreadsheets.readonly', spreadsheetId ? `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=spreadsheetId` : null],
    ];
    const services = await Promise.all(checks.map(async ([service, capability, url]) => {
      if (!metadata.capabilities[capability]) return { service, state: 'scope_missing' };
      if (!url) return { service, state: 'not_checked', reason: 'spreadsheet_id_required' };
      const r = await requestJson(fetcher, url, { headers });
      return { service, state: r.ok ? 'connected' : 'failed', http: r.status };
    }));
    return { ok: services.every(s => ['connected', 'not_checked'].includes(s.state)), identity: 'matched', services };
  } catch {
    // APIのエラー本文・URL・トークンを診断出力へ混ぜない。
    return { ok: false, reason: 'network_or_response_error' };
  }
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes('--help')) {
    console.log('node tools/google-workspace/doctor.mjs --account <メールアドレス> [--online] [--broker <自分が管理するHTTPSオリジン>]\n保存済みGoogle接続を診断します。--onlineも読み取りのみです。\n任意: KATAZUKU_GOOGLE_CREDENTIALS_DIR / KATAZUKU_GOOGLE_SPREADSHEET_ID\nアプリ審査の状態はGoogle Auth Platformの検証センターで確認してください。');
    return 0;
  }
  const accountIndex = args.indexOf('--account');
  const account = accountIndex >= 0 ? args[accountIndex + 1] : process.env.USER_GOOGLE_EMAIL;
  const brokerIndex = args.indexOf('--broker');
  if (args.some((arg, i) => !['--account', '--online', '--broker'].includes(arg)
    && !(accountIndex >= 0 && i === accountIndex + 1) && !(brokerIndex >= 0 && i === brokerIndex + 1))) throw new Error('不明な引数です。--helpを参照してください。');
  let trustedTokenEndpoint;
  if (brokerIndex >= 0) {
    try {
      const broker = new URL(args[brokerIndex + 1]);
      if (broker.protocol !== 'https:' || broker.pathname !== '/' || broker.search || broker.hash || broker.username || broker.password) throw new Error();
      trustedTokenEndpoint = broker.origin + '/token';
    } catch { throw new Error('自分が管理する認証サーバーのHTTPSオリジンを指定してください。'); }
  }
  const path = credentialPath(account, process.env.KATAZUKU_GOOGLE_CREDENTIALS_DIR);
  let stored;
  try { stored = JSON.parse(await readFile(path, 'utf8')); } catch { throw new Error('接続資格情報がありません。google:connectで本人が認証してください。'); }
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) throw new Error('接続資格情報の形式が不正です。');
  const metadata = inspectCredential(stored);
  const live = args.includes('--online') ? await checkOnline(stored, account, { spreadsheetId: process.env.KATAZUKU_GOOGLE_SPREADSHEET_ID, trustedTokenEndpoint }) : undefined;
  console.log(JSON.stringify({ ...metadata, ...(live ? { live } : {}) }, null, 2));
  return live ? (live.ok ? 0 : 1) : (metadata.clientConfigured && metadata.refreshAvailable ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
