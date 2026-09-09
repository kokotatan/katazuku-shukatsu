const config = JSON.parse(document.getElementById('bootstrap').textContent);
const byId = id => document.getElementById(id);
byId('account').textContent = config.account;
byId('broker').textContent = config.broker;
byId('existing').textContent = config.hasExistingConnection ? (config.replace ? '既存の接続をバックアップして、新しい接続に置き換えます。' : '既存の接続があります。別の認証サービスへの置き換えは、この起動方法では行いません。') : 'このアカウントの接続を新しく保存します。';
for (const scope of config.scopes) { const item = document.createElement('li'); item.textContent = scope; byId('scopes').append(item); }
async function post(path) {
  const response = await fetch('/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Katazuku-CSRF': config.csrf }, body: '{}' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '接続に失敗しました。');
  return result;
}
function showState(state) {
  byId('status').textContent = state.message;
  byId('check').disabled = state.status !== 'connected';
  byId('connect').disabled = ['authorizing', 'connected'].includes(state.status);
  if (state.status !== 'authorizing') byId('google-link').hidden = true;
  if (state.missingScopes?.length) byId('status').textContent += ' 一部の権限は許可されていません。許可した機能のみ利用できます。';
  if (state.diagnostic) {
    byId('diagnostic').replaceChildren();
    const names = { gmail: 'Gmail', calendar: 'カレンダー', drive: 'Drive', sheets: 'スプレッドシート' };
    for (const service of state.diagnostic.services || []) {
      const line = document.createElement('p');
      line.textContent = `${names[service.service]}：${service.state === 'connected' ? '接続できました' : service.state === 'not_checked' ? '確認するシートが未指定です' : '接続を確認できませんでした'}`;
      byId('diagnostic').append(line);
    }
    if (!state.diagnostic.ok) { const line = document.createElement('p'); line.textContent = '接続確認に失敗した項目があります。'; byId('diagnostic').append(line); }
  }
}
byId('connect').addEventListener('click', async () => {
  byId('connect').disabled = true;
  try {
    const result = await post('connect');
    byId('google-link').href = result.authorizationUrl;
    byId('google-link').hidden = false;
    byId('status').textContent = '「Googleの認証画面を開く」からアカウントと権限を確認してください。';
  } catch (error) { byId('status').textContent = error.message; byId('connect').disabled = false; }
});
byId('check').addEventListener('click', async () => {
  byId('check').disabled = true;
  try { await post('check'); await refresh(); }
  catch (error) { byId('status').textContent = error.message; byId('check').disabled = false; }
});
async function refresh() {
  const response = await fetch('/api/status');
  if (!response.ok) throw new Error('接続状態を読めません。');
  showState(await response.json());
}
await refresh();
setInterval(() => refresh().catch(() => { byId('status').textContent = 'PC側の接続処理が終了しました。'; byId('check').disabled = true; byId('connect').disabled = true; }), 2000);
