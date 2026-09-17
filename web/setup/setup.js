import { derivePasswordProof } from '/auth-proof.js'
const $ = id => document.getElementById(id)
let challenge
// 設定の引換券は10分・一度だけ。URL、保存領域、ログに残さない。
let setupToken = new URLSearchParams(location.hash.slice(1)).get('setup') || ''
history.replaceState(null, '', location.pathname)
const api = async (path, value) => {
  const response = await fetch('/api/auth/' + path, { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || '接続できませんでした。')
  return result
}
const error = reason => { $('message').textContent = ''; $('error').hidden = false; $('error').textContent = reason instanceof Error ? reason.message : '接続できませんでした。' }
async function start() {
  if (!setupToken) { $('guide').hidden = false; $('message').textContent = ''; return }
  try {
    const result = await api('inspect-setup', { setupToken })
    challenge = result
    $('device').textContent = result.deviceName
    $('title').textContent = result.configured ? 'パスワードを再設定' : 'パスワードを設定'
    $('reset-note').hidden = !result.configured
    $('entry').hidden = false; $('message').textContent = ''
  } catch (e) { setupToken = ''; $('guide').hidden = false; error(e) }
}
$('setup-form').addEventListener('submit', async event => {
  event.preventDefault(); $('error').hidden = true
  const password = $('password').value
  if ([...password].length < 15 || password.length > 256) { error(new Error('パスワードは15文字以上、256文字以内にしてください。')); return }
  if (password !== $('confirm').value) { error(new Error('2つのパスワードが一致していません。')); $('confirm').focus(); return }
  $('save').disabled = true; $('message').textContent = '設定しています…'
  try {
    const passwordProof = await derivePasswordProof(password, challenge)
    await api('setup', { setupToken, passwordProof }); setupToken = ''
    $('setup-form').reset(); $('entry').hidden = true; $('done').hidden = false; $('message').textContent = ''
    try { localStorage.removeItem('katazuku/read-key'); localStorage.setItem('katazuku/auth-change', String(Date.now())) } catch { /* 保存なしで続行 */ }
  } catch (e) { error(e) } finally { $('save').disabled = false }
})
void start()
