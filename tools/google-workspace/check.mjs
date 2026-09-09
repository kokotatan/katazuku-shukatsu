import assert from 'node:assert/strict';
import { credentialPath, inspectCredential, checkOnline, tokenEndpoint } from './doctor.mjs';
import { DEFAULT_BROKER_ORIGIN, GOOGLE_TOKEN_URL } from './scopes.mjs';

const account = 'person@example.com';
const stored = { client_id: '123-example.apps.googleusercontent.com', client_secret: 'example-secret', refresh_token: 'example-refresh',
  scopes: ['openid', 'https://www.googleapis.com/auth/userinfo.email', ...['gmail.modify', 'calendar', 'drive', 'spreadsheets'].map(s => `https://www.googleapis.com/auth/${s}`)] };
assert.throws(() => credentialPath('../person@example.com'));
assert.throws(() => credentialPath('person@example.com/../../credentials'));
assert.equal(inspectCredential(stored).capabilities['gmail.readonly'], true);
assert.equal(inspectCredential(stored).capabilities['gmail.settings.basic'], false);
assert.equal(inspectCredential({ ...stored, scopes: ['https://www.googleapis.com/auth/drive.file'] }).capabilities['drive.readonly'], false);
assert.equal(inspectCredential(stored).verification, 'not_checked');
assert.equal(tokenEndpoint(stored), GOOGLE_TOKEN_URL);
assert.equal(tokenEndpoint({ ...stored, token_uri: DEFAULT_BROKER_ORIGIN + '/token' }), DEFAULT_BROKER_ORIGIN + '/token');
assert.equal(tokenEndpoint({ ...stored, token_uri: 'https://outside.example.com/token' }), null);
assert.equal(tokenEndpoint(stored, 'https://example-secret@outside.example.com/token'), null);
assert.equal(tokenEndpoint(stored, 'https://outside.example.com/token?credential=example-secret'), null);
assert.deepEqual(inspectCredential({ scopes: ['example-secret', 'https://outside.example.com/token?credential=example-secret', 'openid'] }).scopes, ['openid']);
let calls = [];
function fake({ email = account, tokenError, apiStatus = 200 } = {}) {
  return async (url, options) => {
    calls.push({ url, options });
    if (url === 'https://oauth2.googleapis.com/token') return new Response(JSON.stringify(tokenError ? { error: tokenError } : { access_token: 'example-access' }), { status: tokenError ? 400 : 200 });
    if (url.endsWith('/userinfo')) return new Response(JSON.stringify({ email, verified_email: true }));
    return new Response('{}', { status: apiStatus });
  };
}
let result = await checkOnline(stored, account, { fetcher: fake() });
assert.equal(result.ok, true);
assert.equal(result.services.filter(s => s.state === 'connected').length, 3);
assert.equal(result.services.find(s => s.service === 'sheets').state, 'not_checked');
assert.equal(calls.filter(c => c.options.method === 'POST').length, 1);
assert.equal(calls.filter(c => c.options.headers).every(c => !c.options.method), true);
assert.equal(calls.every(c => c.options.redirect === 'error'), true);
assert.doesNotMatch(JSON.stringify(result), /example-(access|refresh|secret)/);
calls = [];
result = await checkOnline({ ...stored, token_uri: 'https://outside.example.test/token' }, account, { fetcher: fake() });
assert.equal(result.reason, 'unexpected_token_endpoint');
assert.equal(calls.length, 0);
result = await checkOnline(stored, account, { fetcher: fake({ tokenError: 'invalid_grant' }) });
assert.equal(result.reason, 'reauthentication_required');
calls = [];
result = await checkOnline(stored, account, { fetcher: fake({ email: 'someone@example.com' }) });
assert.equal(result.reason, 'account_mismatch');
assert.equal(calls.length, 2);
result = await checkOnline(stored, account, { fetcher: fake({ apiStatus: 403 }) });
assert.equal(result.ok, false);
result = await checkOnline(stored, account, { fetcher: fake(), spreadsheetId: 'example-spreadsheet' });
assert.equal(result.services.find(s => s.service === 'sheets').state, 'connected');
result = await checkOnline(stored, account, { fetcher: fake(), spreadsheetId: '../outside?token=x' });
assert.equal(result.reason, 'invalid_spreadsheet_id');
console.log('Google接続診断: アカウント照合・送信先固定・失効・権限・読み取り限定・秘密非出力を検証しました。');
