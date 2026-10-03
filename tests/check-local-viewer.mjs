import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import { createViewerServer, VIEWER_APPS, readBriefs } from '../tools/viewer-server.mjs'

async function fixture(t, demo, dataAvailable = true) {
  const root = await mkdtemp(join(tmpdir(), 'katazuku-viewer-'))
  for (const app of VIEWER_APPS) {
    await mkdir(join(root, app, 'dist', 'assets'), { recursive: true })
    await mkdir(join(root, app, 'public'), { recursive: true })
    await writeFile(join(root, app, 'dist', 'index.html'), `<h1>${app}</h1>`)
    await writeFile(join(root, app, 'dist', 'assets', 'app.js'), 'console.log("synthetic")')
    await writeFile(join(root, app, 'public', 'snapshot.demo.json'), JSON.stringify({ demo: true, companies: ['会社A'] }))
  }
  await mkdir(join(root, 'tools'))
  await writeFile(join(root, 'tools', 'viewer-home.html'), '<h1>はじめる</h1>')
  await writeFile(join(root, 'tools', 'viewer-home.js'), 'console.log("home")')
  await writeFile(join(root, '.env'), 'SYNTHETIC_PRIVATE_VALUE=not-for-browser')
  await mkdir(join(root, 'logs', 'briefs'), { recursive: true })
  const server = createViewerServer({ root, demo, dataAvailable })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }) })
  return { root, url }
}

test('8画面を独立したURLで配信し、assetsとJSONを正しい型で返す', async (t) => {
  const { url } = await fixture(t, true)
  for (const app of VIEWER_APPS) assert.equal(await (await fetch(`${url}/${app}/`)).text(), `<h1>${app}</h1>`)
  const asset = await fetch(`${url}/board/assets/app.js`)
  assert.match(asset.headers.get('content-type'), /javascript/)
  const data = await fetch(`${url}/board/snapshot.json`)
  assert.equal((await data.json()).demo, true)
  assert.equal(data.headers.get('cache-control'), 'no-store')
  assert.equal(data.headers.get('x-frame-options'), 'DENY')
})

test('自分のデータがなければデモへ切り替えず、更新後は新しいJSONを読む', async (t) => {
  const { root, url } = await fixture(t, false)
  assert.equal((await fetch(`${url}/board/snapshot.json`)).status, 404)
  assert.equal((await fetch(`${url}/board/snapshot.demo.json`)).status, 404)
  await writeFile(join(root, 'board', 'public', 'snapshot.json'), JSON.stringify({ companies: ['会社B'], demo: false }))
  assert.deepEqual(await (await fetch(`${url}/board/snapshot.json`)).json(), { companies: ['会社B'], demo: false })
  await writeFile(join(root, 'board', 'public', 'snapshot.json'), JSON.stringify({ companies: ['会社C'], demo: false }))
  assert.deepEqual((await (await fetch(`${url}/board/snapshot.json`)).json()).companies, ['会社C'])
})

test('デモは実データと実ブリーフを読まず、ローカル生成の架空データを使う', async (t) => {
  const { root, url } = await fixture(t, true)
  await writeFile(join(root, 'board', 'public', 'snapshot.json'), JSON.stringify({ companies: ['real-synthetic-marker'] }))
  await writeFile(join(root, 'logs', 'briefs', 'asa-2099-01-01.local.md'), 'real-synthetic-brief')
  await writeFile(join(root, 'logs', 'viewer-demo.local.json'), JSON.stringify({ companies: ['demo-synthetic-marker'], demo: true }))
  const data = await (await fetch(`${url}/board/snapshot.json`)).json()
  assert.deepEqual(data.companies, ['demo-synthetic-marker'])
  const briefs = await (await fetch(`${url}/api/briefs`)).json()
  assert(!JSON.stringify(briefs).includes('real-synthetic-brief'))
  assert(briefs.every((row) => row.date === 'デモ'))
})

test('指定DBがなければ古いsnapshotやブリーフを表示せず、モードの取り違えを拒否する', async (t) => {
  const missing = await fixture(t, false, false)
  await writeFile(join(missing.root, 'board', 'public', 'snapshot.json'), JSON.stringify({ demo: false, companies: ['old-db'] }))
  await writeFile(join(missing.root, 'logs', 'briefs', 'asa-2099-01-01.local.md'), 'old-db-brief')
  assert.equal((await fetch(missing.url + '/board/snapshot.json')).status, 404)
  assert.deepEqual(await (await fetch(missing.url + '/api/briefs')).json(), [])
  const local = await fixture(t, false)
  await writeFile(join(local.root, 'board', 'public', 'snapshot.json'), JSON.stringify({ demo: true, companies: ['demo-in-real-path'] }))
  assert.equal((await fetch(local.url + '/board/snapshot.json')).status, 409)
  const demo = await fixture(t, true)
  await writeFile(join(demo.root, 'logs', 'viewer-demo.local.json'), JSON.stringify({ demo: false, companies: ['real-in-demo-path'] }))
  assert.equal((await fetch(demo.url + '/board/snapshot.json')).status, 409)
})

test('正本や秘密、任意のログ、パストラバーサルを配信せず、書き込みも拒否する', async (t) => {
  const { url } = await fixture(t, false)
  for (const path of ['/.env', '/logs/briefs/asa-2099-01-01.local.md', '/board/../../.env', '/board/%2e%2e%2f%2e%2e%2f.env', '/board/%5c..%5c.env', '/unknown/', '/board/missing.js']) {
    const response = await fetch(url + path)
    assert(response.status >= 400, path)
    assert(!(await response.text()).includes('not-for-browser'))
  }
  assert.equal((await fetch(url + '/', { method: 'POST' })).status, 405)
  assert.equal((await fetch(url + '/api/viewer', { headers: { Origin: 'https://evil.example.com' } })).status, 403)
  assert.equal((await fetch(url + '/', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403)
  const hostStatus = await new Promise((resolve) => {
    const req = request(url + '/', { headers: { Host: 'evil.example.com' } }, (res) => { res.resume(); resolve(res.statusCode) })
    req.end()
  })
  assert.equal(hostStatus, 403)
})

test('distへコピーされた実データをデモの静的URLから配信しない', async (t) => {
  const { root, url } = await fixture(t, true)
  for (const name of ['snapshot.json', 'snapshot.demo.json', 'private.js']) {
    await writeFile(join(root, 'board', 'dist', name), 'real-synthetic-marker')
  }
  await writeFile(join(root, 'board', 'dist', 'assets', 'private.json'), 'real-synthetic-marker')
  for (const path of ['/board/SNAPSHOT.JSON', '/board/assets/..%2fsnapshot.json',
    '/board/assets/..%2fsnapshot.demo.json', '/board/assets/private.json', '/board/assets/..%2fprivate.js']) {
    const response = await fetch(url + path)
    assert.equal(response.status, 404, path)
    assert(!(await response.text()).includes('real-synthetic-marker'))
  }
  assert.equal((await (await fetch(url + '/board/snapshot.json')).json()).demo, true)
})

test('ブリーフは種類ごとの最新だけを返し、大きなファイルと任意ファイルを除外する', async (t) => {
  const { root, url } = await fixture(t, false)
  const dir = join(root, 'logs', 'briefs')
  await writeFile(join(dir, 'asa-2099-01-01.local.md'), 'old')
  await writeFile(join(dir, 'asa-2099-01-02.local.md'), '<script>synthetic</script>')
  await writeFile(join(dir, 'evening-2099-01-02.local.md'), 'evening')
  await writeFile(join(dir, 'other.local.md'), 'not-allowed')
  const rows = await (await fetch(url + '/api/briefs')).json()
  assert.deepEqual(rows.map((row) => [row.kind, row.date]), [['asa', '2099-01-02'], ['evening', '2099-01-02']])
  assert.equal(rows[0].text, '<script>synthetic</script>', '画面側はtextContentで表示しHTMLとして実行しない')
  await writeFile(join(dir, 'asa-2099-01-03.local.md'), 'x'.repeat(65_537))
  assert.deepEqual((await readBriefs(root)).map((row) => row.kind), ['evening'])
})

test('ビルド内の外部ファイルへのsymlinkは配信しない', async (t) => {
  const { root, url } = await fixture(t, false)
  try { await symlink(join(root, '.env'), join(root, 'board', 'dist', 'assets', 'private.js')) }
  catch (error) { if (error.code === 'EPERM') { t.skip('このWindows環境ではsymlink権限がない'); return } throw error }
  assert.equal((await fetch(url + '/board/assets/private.js')).status, 404)
})
