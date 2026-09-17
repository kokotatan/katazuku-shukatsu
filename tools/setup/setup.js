const $ = id => document.getElementById(id)
let csrf = '', busy = false, cloudPhase = ''
async function refresh() {
  const response = await fetch('/api/status', { cache: 'no-store' }); if (!response.ok) throw new Error('PCの設定を読めませんでした。')
  const state = await response.json(); csrf = state.csrf
  if (!$('device').value) $('device').value = state.deviceName
  if (!$('account').value) $('account').value = state.account
  $('folder').textContent = state.database
  $('source-note').textContent = state.satellite ? 'このPCは認証・確認用です。アプリに表示するのは、自分のMiniPCから同期した記録です。' : 'このPCの正本データを使います。他のPCの記録は自動では取り込まれません。'
  $('origin').textContent = state.appOrigin || '未設定'
  $('cloud-setup').hidden = state.cloudReady || !state.cloud
  if (!$('data-folder').value) $('data-folder').value = state.dataFolder
  $('cloud-state').textContent = state.cloud?.message || ''
  $('sync-controls').hidden = !state.syncReady
  $('sync-state').textContent = state.cloud?.message || ''
  $('sync-time').textContent = state.cloud?.syncedAt ? '最終同期: ' + new Date(state.cloud.syncedAt).toLocaleString('ja-JP') : ''
  $('sync').disabled = state.cloud?.running || busy
  $('cloud-create').disabled = state.cloud?.running || busy
  $('cloud-login').disabled = state.cloud?.running || busy
  if (state.cloud?.phase === 'select' && cloudPhase !== 'select') void loadAccounts()
  cloudPhase = state.cloud?.phase || ''
  $('password').disabled = !state.cloudReady || busy
  $('cloud-message').textContent = state.cloudReady ? 'スマートフォンも、ここで設定したパスワードでログインできます。' : '先に「保存先を用意する」を完了してください。'
  if (state.appOrigin) { $('app').href = state.appOrigin; $('app').hidden = false }
  $('google-state').textContent = state.google?.message || ''
  $('message').textContent = ''
}
async function cloudAction(path, data = {}) {
  const response = await fetch('/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Katazuku-CSRF': csrf }, body: JSON.stringify(data) })
  const result = await response.json(); if (!response.ok) throw new Error(result.error || '操作できませんでした。')
  return result
}
function showError(e) { $('error').textContent = e.message; $('error').hidden = false }
async function loadAccounts() {
  const result = await cloudAction('cloud/accounts')
  $('cloud-account').replaceChildren(...result.accounts.map(account => { const option = document.createElement('option'); option.value = account.id; option.textContent = account.name; return option }))
  if (!result.accounts.length) $('cloud-state').textContent = '先にCloudflareへログインしてください。'
}
$('cloud-login').addEventListener('click', () => { void cloudAction('cloud/login').then(refresh).catch(showError) })
$('cloud-accounts').addEventListener('click', () => { void loadAccounts().catch(showError) })
$('choose-folder').addEventListener('click', () => { void cloudAction('folder').then(result => { if (result.path) $('data-folder').value = result.path }).catch(showError) })
$('cloud-create').addEventListener('click', () => { void cloudAction('cloud/create', { accountId: $('cloud-account').value, deviceName: $('device').value, dataFolder: $('data-folder').value }).then(refresh).catch(showError) })
$('sync').addEventListener('click', () => { void cloudAction('cloud/sync').then(refresh).catch(showError) })
setInterval(() => { if (!busy) void refresh().catch(() => {}) }, 5000)
async function run(path, data) {
  if (busy) return
  busy = true; $('error').hidden = true; $('message').textContent = '準備しています…'
  try {
    const response = await fetch('/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Katazuku-CSRF': csrf }, body: JSON.stringify(data) })
    const result = await response.json(); if (!response.ok) throw new Error(result.error || '設定を開けませんでした。')
    location.assign(result.url)
  } catch (e) { $('error').textContent = e.message; $('error').hidden = false; $('message').textContent = '' }
  finally { busy = false }
}
$('password').addEventListener('click', () => run('password', { deviceName: $('device').value }))
$('google').addEventListener('click', () => { if ($('account').reportValidity()) void run('google', { account: $('account').value }) })
window.addEventListener('focus', () => { if (!busy) void refresh().catch(() => {}) })
void refresh().catch(e => { $('error').textContent = e.message; $('error').hidden = false; $('message').textContent = '' })
