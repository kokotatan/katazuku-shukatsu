/** 配布物をそのまま起動し、Node/npmなしのPATHと架空プロファイルでIPCから8画面まで確認する。 */
import { strict as assert } from 'node:assert'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const folder = resolve(process.argv[2] || '')
assert(process.argv[2], '配布フォルダーを指定してください')
assert(process.argv.slice(3).every(value => value === '--screenshot'), '不明なオプションです')
const fixture = mkdtempSync(join(tmpdir(), 'katazuku-portable-test-'))
const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8'))
for (const file of manifest.files) assert.equal(createHash('sha256').update(readFileSync(join(folder, file.path))).digest('hex'), file.sha256, file.path)
const listener = createServer()
await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
const port = listener.address().port
await new Promise(resolve => listener.close(resolve))
const env = { ...process.env, PATH: join(process.env.SystemRoot, 'System32') }
delete env.ELECTRON_RUN_AS_NODE
for (const key of Object.keys(env)) if (/^KATAZUKU_/i.test(key)) delete env[key]
env.KATAZUKU_CONFIG = join(fixture, 'must-not-be-written.json')
const child = spawn(join(folder, 'katazuku.exe'), [`--test-profile=${fixture}`, '--test-hidden', `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], { cwd: fixture, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
let log = ''
child.stdout.setEncoding('utf8')
child.stderr.setEncoding('utf8')
child.stdout.on('data', value => { log = (log + value).slice(-12000) })
child.stderr.on('data', value => { log = (log + value).slice(-12000) })
const sockets = []
async function connect(url) {
  const ws = new WebSocket(url); sockets.push(ws)
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })
  let id = 0; const waiting = new Map()
  ws.addEventListener('message', event => { const value = JSON.parse(event.data); const pending = waiting.get(value.id); if (pending) { waiting.delete(value.id); clearTimeout(pending.timer); value.error ? pending.reject(new Error(value.error.message)) : pending.resolve(value.result) } })
  ws.addEventListener('close', () => { for (const pending of waiting.values()) { clearTimeout(pending.timer); pending.reject(new Error('CDP connection closed')) } waiting.clear() })
  return { call(method, params = {}) { return new Promise((resolve, reject) => {
    const key = ++id
    const timer = setTimeout(() => { waiting.delete(key); reject(new Error('CDP timeout: ' + method)) }, 30_000)
    waiting.set(key, { resolve, reject, timer }); ws.send(JSON.stringify({ id: key, method, params }))
  }) } }
}
async function pages() { return (await fetch(`http://127.0.0.1:${port}/json/list`)).json() }
async function evaluate(client, expression) {
  const result = await client.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails))
  return result.result.value
}
const checks = []
try {
  let page
  for (let i = 0; i < 200; i++) {
    try { page = (await pages()).find(page => page.url.endsWith('/index.html')); if (page) break } catch { /* 起動待ち */ }
    if (child.exitCode !== null) throw new Error('アプリが終了しました: ' + log)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert(page, 'ウィザードが起動する: ' + log)
  const wizard = await connect(page.webSocketDebuggerUrl)
  for (let i = 0; i < 100; i++) {
    if (await evaluate(wizard, "document.readyState === 'complete' && !!window.katazuku")) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  const initial = await evaluate(wizard, 'window.katazuku.status()')
  assert.equal(initial.packaged, true); assert.equal(initial.repoReady, true); assert.equal(initial.config, null)
  checks.push('同梱ランタイムでウィザード起動')
  // 非表示ウィンドウの画像取得は環境によって完了しないため、目視確認時だけ明示指定する。
  if (process.argv.includes('--screenshot')) {
    const welcomeImage = await wizard.call('Page.captureScreenshot')
    writeFileSync(join(fixture, 'wizard.png'), Buffer.from(welcomeImage.data, 'base64'))
  }
  await evaluate(wizard, "document.getElementById('open-demo').click()")
  for (let i = 0; i < 100; i++) {
    if (await evaluate(wizard, "!document.getElementById('open-demo').disabled")) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert((await evaluate(wizard, "document.getElementById('demo-result').textContent")).includes('開きました'))
  const viewerPage = (await pages()).find(page => page.url.startsWith('http://127.0.0.1:'))
  assert(viewerPage)
  const viewer = await connect(viewerPage.webSocketDebuggerUrl)
  assert.equal(await evaluate(viewer, 'typeof window.katazuku'), 'undefined')
  const origin = new URL(viewerPage.url).origin
  assert.equal((await (await fetch(origin + '/api/viewer')).json()).mode, 'demo')
  for (const name of ['board', 'status', 'inbox', 'insight', 'profile', 'people', 'prep', 'impact']) {
    await viewer.call('Page.navigate', { url: origin + '/' + name + '/' })
    let text = ''
    for (let i = 0; i < 100; i++) {
      text = await evaluate(viewer, `location.pathname === '/${name}/' && document.readyState === 'complete' ? document.body.innerText : ''`)
      if (text.length > 100 && !text.includes('データを読み込んでいます')) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert(text.length > 100, name + 'に内容がある')
    assert(!/データを取得できません|データの取得に失敗/.test(text), name + 'の取得成功')
    assert.equal((await (await fetch(origin + '/' + name + '/snapshot.json')).json()).demo, true)
    checks.push(name + 'の架空データ表示')
  }
  const form = { displayName: '利用者A（架空）', email: 'you@example.test', signature: '利用者A（架空）', providerOrder: ['chatgpt-siwc'] }
  assert.equal((await evaluate(wizard, `window.katazuku.saveConfig(${JSON.stringify({ ...form, providerOrder: [] })})`)).ok, false)
  await evaluate(wizard, `document.querySelector('[data-panel="0"] [data-next]').click(); document.querySelector('[data-panel="1"] [data-next]').click(); document.getElementById('open-setup').click()`)
  let helpPage
  for (let i = 0; i < 100; i++) {
    helpPage = (await pages()).find(page => page.url.startsWith('data:text/html'))
    if (helpPage) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert(helpPage, '同梱手順がアプリ内で開く')
  const help = await connect(helpPage.webSocketDebuggerUrl)
  let helpText = ''
  for (let i = 0; i < 100; i++) {
    helpText = await evaluate(help, "document.readyState === 'complete' ? document.body.innerText : ''")
    if (helpText.length > 100) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert(helpText.includes('Google') && helpText.includes('セットアップ'))
  assert.equal(await evaluate(help, 'typeof window.katazuku'), 'undefined')
  await help.call('Page.close').catch(error => { if (!error.message.includes('connection closed')) throw error })
  checks.push('同梱セットアップ手順を外部アプリなしで表示')
  await evaluate(wizard, `document.querySelector('[data-panel="2"] [data-next]').click();
    document.querySelector('[name="displayName"]').value=${JSON.stringify(form.displayName)};
    document.querySelector('[name="email"]').value=${JSON.stringify(form.email)};
    document.querySelector('[name="signature"]').value=${JSON.stringify(form.signature)};
    document.querySelector('[value="chatgpt-siwc"]').checked=true;
    document.getElementById('config').requestSubmit()`)
  for (let i = 0; i < 200; i++) {
    if (await evaluate(wizard, '!document.querySelector(\'[data-panel="4"]\').hidden')) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert(await evaluate(wizard, '!document.querySelector(\'[data-panel="4"]\').hidden'), '設定フォーム送信で次の画面へ進む')
  checks.push('設定フォーム送信から保存成功・次の画面まで進む')
  assert.equal((await evaluate(wizard, 'window.katazuku.status()')).config.displayName, form.displayName)
  const configPath = join(fixture, 'katazuku.config.json')
  const before = readFileSync(configPath, 'utf8')
  assert.equal(JSON.parse(before).google.credentialsDir, join(fixture, 'google'))
  assert.equal((await evaluate(wizard, `window.katazuku.saveConfig(${JSON.stringify(form)})`)).ok, false)
  assert.equal(readFileSync(configPath, 'utf8'), before)
  assert(!existsSync(env.KATAZUKU_CONFIG))
  checks.push('同梱子Nodeで設定検証・保存・上書き防止・保存領域分離')
  const diagnosis = await evaluate(wizard, 'window.katazuku.setupCheck()')
  assert(diagnosis.output.length > 30); assert(!diagnosis.output.includes('ERR_MODULE_NOT_FOUND'))
  checks.push('ローカル診断起動（未接続は不足として表示）')
  const dry = await evaluate(wizard, 'window.katazuku.dryRun()'); assert.equal(dry.ok, true, dry.output)
  assert(!existsSync(join(fixture, 'data', 'katazuku.db')))
  checks.push('外部通信なしの試し実行')
  assert(!existsSync(join(folder, 'resources', 'app', 'runtime', 'logs')), '試し実行は配布先にログ用ディレクトリを作らない')
  assert.equal((await evaluate(wizard, 'window.katazuku.schedulePreview()')).ok, false)
  for (const file of manifest.files) assert.equal(createHash('sha256').update(readFileSync(join(folder, file.path))).digest('hex'), file.sha256, '起動後も配布ファイル不変: ' + file.path)
  writeFileSync(join(fixture, 'result.json'), JSON.stringify({ checks, log }, null, 2))
  console.log(JSON.stringify({ checks, report: join(fixture, 'result.json') }, null, 2))
} catch (error) {
  console.error(JSON.stringify({ checks, failure: String(error), log, fixture }, null, 2))
  throw error
} finally {
  try { const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); const browser = await connect(version.webSocketDebuggerUrl); await browser.call('Browser.close') } catch { /* 自分で起動したプロセスだけ後始末する */ }
  for (const socket of sockets) socket.close()
  child.kill()
}
