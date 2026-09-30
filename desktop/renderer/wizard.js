// 初回ウィザードの画面側。preload が渡す window.katazuku 以外の機能は使わない。
const api = window.katazuku
let step = 0

function show(next) {
  step = next
  for (const panel of document.querySelectorAll('[data-panel]')) panel.hidden = Number(panel.dataset.panel) !== step
  for (const item of document.querySelectorAll('[data-step]')) item.classList.toggle('current', Number(item.dataset.step) === step)
}

for (const button of document.querySelectorAll('[data-next]')) button.addEventListener('click', () => show(step + 1))

async function refreshStatus() {
  const status = await api.status()
  const found = [status.providers.claude && 'Claude Code', status.providers.codex && 'Codex'].filter(Boolean)
  document.getElementById('cli-status').textContent = found.length
    ? `見つかりました: ${found.join(' / ')}。ログインは各アプリで本人が行います。`
    : '見つかりませんでした(入れなくても ChatGPT のプランで始められます)。'
}

document.getElementById('chatgpt').addEventListener('click', async () => {
  const out = document.getElementById('chatgpt-result')
  out.textContent = 'ブラウザで ChatGPT のサインインと許可を行ってください...'
  const result = await api.chatgptSignIn()
  out.textContent = result.output
})

document.getElementById('open-setup').addEventListener('click', () => api.openDocs('setup'))
document.getElementById('open-workflows').addEventListener('click', () => api.openDocs('workflows'))

document.getElementById('config').addEventListener('submit', async (event) => {
  event.preventDefault()
  const form = new FormData(event.target)
  const result = await api.saveConfig({
    displayName: form.get('displayName'),
    email: form.get('email'),
    signature: form.get('signature'),
    providerOrder: form.getAll('provider'),
  })
  document.getElementById('config-result').textContent = result.output
  if (result.ok) show(4)
})

document.getElementById('dry-run').addEventListener('click', async () => {
  document.getElementById('run-result').textContent = (await api.dryRun()).output
})
document.getElementById('schedule').addEventListener('click', async () => {
  document.getElementById('run-result').textContent = (await api.schedulePreview()).output
})

show(0)
refreshStatus()
