import { createServer } from 'node:http'

const fixtureUser = 'fixture-user@example.test'
const fixturePassword = 'fixture-password-42'

function html(mode) {
  const blocker = mode === 'mfa'
    ? '<label for="otp">認証コード</label><input id="otp" autocomplete="one-time-code">'
    : mode === 'captcha'
      ? '<div class="captcha">CAPTCHA: 私はロボットではありません</div>'
      : ''
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>ローカルログイン試験</title>
<style>
body{font-family:system-ui,sans-serif;max-width:560px;margin:40px auto;padding:24px;border:1px solid #cbd5e1}
label,input,button{display:block;width:100%;box-sizing:border-box;margin-top:12px}
input,button{padding:10px}
[data-result="ok"]{color:#166534}
[data-result="rejected"]{color:#991b1b}
</style>
</head>
<body>
<main data-result="">
<h1>マイページログイン</h1>
<label for="search">サイト内検索</label>
<input id="search" name="query" type="search" placeholder="キーワード">
<label for="login-id">ログインID</label>
<input id="login-id" name="login_id" type="email" autocomplete="username" required>
<label for="password">パスワード</label>
<input id="password" name="password" type="password" autocomplete="current-password" required>
${blocker}
<button id="login-button" type="submit">ログイン</button>
<p id="status"></p>
</main>
<script>
const mode = ${JSON.stringify(mode)}
document.querySelector('button').addEventListener('click', (event) => {
  event.preventDefault()
  if (mode !== 'login') return
  const username = document.querySelector('#login-id')
  const password = document.querySelector('#password')
  const ok = username.value === ${JSON.stringify(fixtureUser)} && password.value === ${JSON.stringify(fixturePassword)}
  username.value = ''
  password.value = ''
  const main = document.querySelector('main')
  main.dataset.result = ok ? 'ok' : 'rejected'
  document.querySelector('#status').textContent = ok ? 'ログイン試験成功' : 'ログイン試験失敗'
})
</script>
</body>
</html>`
}

export async function startFixtureServer() {
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname
    const mode = path === '/mfa' ? 'mfa' : path === '/captcha' ? 'captcha' : path === '/login' ? 'login' : null
    if (!mode) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('not found')
      return
    }
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'self' 'unsafe-inline'"
    })
    response.end(html(mode))
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '0.0.0.0', resolve)
  })
  const address = server.address()
  return {
    server,
    port: address.port,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}
