import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { createCloudSetup } from './cloud.mjs'
import { build } from 'esbuild'

const root = await mkdtemp(join(tmpdir(), 'katazuku-cloud-test-'))
const accountId = 'a'.repeat(32)
let created = false, uploaded = false, writes = 0
let remoteState = { sourceId: null, etag: null }, wrongIdentity = false
try {
  await mkdir(join(root, 'web-dist/status'), { recursive: true }); await writeFile(join(root, 'web-dist/status/index.html'), '<!doctype html>')
  // 実装のDBスキーマとsnapshotを使う。活動レコードは投入しない。
  await build({ entryPoints: ['db', 'snapshot', 'http-boundary', 'snapshot-contract'].map(name => resolve(import.meta.dirname, '../../src', name + '.ts')), outdir: join(root, 'dist'), bundle: true, platform: 'node', format: 'esm', packages: 'external' })
  await writeFile(join(root, 'package.json'), '{"type":"module"}')
  const execute = async args => {
    if (args[0] === 'whoami') return JSON.stringify({ accounts: [{ id: accountId, name: '検証用アカウント' }] })
    if (args[0] === 'auth') return JSON.stringify({ token: 'synthetic-only-token' })
    if (args[0] === 'deploy') { uploaded = true; return '' }
    throw new Error('想定していないCLI')
  }
  const fetcher = async (url, options = {}) => {
    const path = new URL(url).pathname
    if (path.endsWith('/workers/subdomain')) return Response.json({ result: { subdomain: 'test-only' } })
    if (path.endsWith('/r2/buckets') && options.method === 'POST') { created = true; writes++; return Response.json({ result: {} }) }
    if (path.includes('/r2/buckets/')) return Response.json({ result: {} }, { status: created ? 200 : 404 })
    if (path.endsWith('/settings')) return Response.json({}, { status: uploaded ? 200 : 404 })
    const saved = JSON.parse(await readFile(join(root, 'credentials/desktop-cloud.local.json'), 'utf8'))
    if (path === '/api/info') return Response.json({ instanceId: wrongIdentity ? 'wrong' : createHash('sha256').update('katazuku-v1\0' + new URL(url).origin + '\0' + saved.readSecret).digest('hex').slice(0, 32) })
    if (path === '/api/sync-state') return Response.json(remoteState)
    if (path === '/api/push') {
      assert.equal(options.headers['X-Katazuku-Source'], saved.sourceId)
      if (remoteState.etag) assert.equal(options.headers['If-Match'], remoteState.etag)
      else assert.equal(options.headers['If-None-Match'], '*')
      assert.equal(JSON.parse(options.body).companies.length, 0)
      remoteState = { sourceId: saved.sourceId, etag: '"abc"' }
      writes++; return Response.json({ ok: true })
    }
    throw new Error('想定していない通信')
  }
  const app = await createCloudSetup(root, { execute, fetcher, pause: async () => {} })
  assert.equal(writes, 0)
  app.create({ accountId, deviceName: '検証専用PC', dataFolder: join(root, 'data') }); await app.whenIdle()
  assert.equal(app.getStatus().phase, 'ready', app.getStatus().message)
  assert.equal(writes, 2); assert.equal(uploaded, true)
  assert.ok(!JSON.stringify(app.getStatus()).includes(app.getConfig().writeSecret))
  app.sync(); await app.whenIdle()
  assert.equal(app.getStatus().phase, 'ready', app.getStatus().message)
  assert.equal(writes, 3)
  await app.syncIfChanged(); assert.equal(writes, 3, '未変更のDBを繰り返し送らない')
  remoteState = { sourceId: 'b'.repeat(36), etag: '"abc"' }
  app.sync(); await app.whenIdle()
  assert.equal(app.getStatus().phase, 'error'); assert.equal(writes, 3, '別PCの正本へ書き込まない')
  remoteState = { sourceId: app.getConfig().sourceId, etag: 'bad-header' }
  app.sync(); await app.whenIdle()
  assert.equal(app.getStatus().phase, 'error'); assert.equal(writes, 3, '不正な同期状態を拒否')
  wrongIdentity = true
  app.sync(); await app.whenIdle()
  assert.equal(app.getStatus().phase, 'error'); assert.equal(writes, 3, '別の保存先へ送信しない')
  const previous = writes
  app.create({ accountId: 'b'.repeat(32), deviceName: '検証専用PC', dataFolder: join(root, 'data') }); await app.whenIdle()
  assert.equal(app.getStatus().phase, 'error'); assert.equal(writes, previous)
  app.create({ accountId, deviceName: '検証専用PC', dataFolder: join(root, 'other') }); await app.whenIdle()
  assert.equal(app.getStatus().phase, 'error'); assert.equal(writes, previous)
  console.log('保存先の作成と継続同期: 実DB・明示開始・アカウント固定・保存先本人確認・競合条件・別PC拒否・秘密非表示を確認')
} finally {
  assert.equal(dirname(resolve(root)), resolve(tmpdir())); assert.ok(root.includes('katazuku-cloud-test-'))
  await rm(root, { recursive: true, force: true })
}
