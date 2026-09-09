// 実アカウントやネットワークを使わず、CLI全体の出力・障害時の挙動を確認する。
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const sync = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = resolve(process.argv[2] || join(sync, 'scripts/gmail-fetch.ts'))
const temp = mkdtempSync(join(tmpdir(), 'katazuku-gmail-check-'))
const fixture = join(temp, 'fixture.mjs')
const metrics = join(temp, 'metrics.json')
const output = join(temp, 'output.json')
const accounts = ['first@example.test', 'second@example.test']
const credentials = join(temp, '.google_workspace_mcp/credentials')
mkdirSync(credentials, { recursive: true })
for (const account of accounts) writeFileSync(join(credentials, account + '.json'), JSON.stringify({
  refresh_token: account, client_id: 'fixture', client_secret: 'fixture',
}))
writeFileSync(fixture, `
import { writeFileSync } from 'node:fs';
const scenario = process.env.FIXTURE_SCENARIO;
let active = 0, maxActive = 0, first = 0, last = 0;
const calls = [];
process.on('exit', () => writeFileSync(process.env.FIXTURE_METRICS, JSON.stringify({ maxActive, fetchMs: last - first, calls })));
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  const method = options.method || 'GET';
  if (url.href === 'https://oauth2.googleapis.com/token' && method === 'POST') {
    return Response.json({ access_token: options.body.get('refresh_token') });
  }
  if (url.origin !== 'https://gmail.googleapis.com' || method !== 'GET') throw Error('許可していない通信');
  const account = options.headers.Authorization.slice(7);
  calls.push({ account, path: url.pathname, page: url.searchParams.get('pageToken') });
  if (url.pathname.endsWith('/messages')) {
    if (scenario === 'empty') return Response.json({});
    const page = url.searchParams.get('pageToken');
    const start = page ? 10 : 0, end = page ? 25 : 10;
    return Response.json({ messages: Array.from({length: end-start}, (_,i) => ({id: String(start+i)})), nextPageToken: page ? undefined : 'next' });
  }
  if (url.pathname.includes('/attachments/')) return Response.json({data: Buffer.from('添付データ').toString('base64url')});
  const id = url.pathname.split('/').at(-1);
  first ||= performance.now();
  active++; maxActive = Math.max(maxActive, active);
  await new Promise(r => setTimeout(r, 40 + (Number(id) % 3) * 5));
  active--; last = performance.now();
  if (scenario === 'failure' && account.startsWith('first') && (id === '3' || id === '4')) return new Response('', {status: 429});
  return Response.json({ id, threadId: 't'+id, internalDate: '1700000000000', payload: {
    headers: [{name:'Subject', value:'件名'+id}], parts: [
      {mimeType:'text/plain', body:{data:Buffer.from('本文'+id).toString('base64url')}},
      {filename:'sample.txt', mimeType:'text/plain', body:{attachmentId:'attachment', size:15}}
    ]
  }});
};
`)

function run(scenario: string, both = false) {
  const started = performance.now()
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--import', pathToFileURL(fixture).href, target, output,
    '--query', 'fixture', '--download-message', '2', '--download-dir', join(temp, 'downloads')], {
    cwd: sync, encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, USERPROFILE: temp, HOME: temp, KATAZUKU_GMAIL_ACCOUNTS: (both ? accounts : accounts.slice(0, 1)).join(','),
      FIXTURE_SCENARIO: scenario, FIXTURE_METRICS: metrics },
  })
  assert.equal(result.status, 0, result.stderr)
  return { totalMs: performance.now() - started, data: JSON.parse(readFileSync(output, 'utf8')), metrics: JSON.parse(readFileSync(metrics, 'utf8')) }
}

try {
  const samples = []
  for (let i = 0; i < 3; i++) {
    const result = run('success')
    assert.equal(result.data.accounts[0].status, 'success')
    assert.deepEqual(result.data.messages.map((m: any) => m.id), Array.from({ length: 25 }, (_, i) => String(i)))
    assert(result.data.messages.every((m: any) => m.body === '本文' + m.id && m.subject === '件名' + m.id))
    assert.equal(result.data.messages[2].downloadedAttachments.length, 1)
    assert.equal(readFileSync(join(temp, 'downloads/sample.txt'), 'utf8'), '添付データ')
    assert(result.metrics.maxActive <= 5)
    samples.push({ totalMs: result.totalMs, fetchMs: result.metrics.fetchMs, maxActive: result.metrics.maxActive })
  }
  const failed = run('failure', true)
  assert.deepEqual(failed.data.accounts.map((a: any) => a.status), ['failed', 'success'])
  assert.deepEqual(failed.data.messages.filter((m: any) => m.account === accounts[0]).map((m: any) => m.id), ['0', '1', '2'])
  assert.equal(failed.data.messages.filter((m: any) => m.account === accounts[1]).length, 25)
  assert(!failed.metrics.calls.some((c: any) => c.account === accounts[0] && /\/messages\/(?:[5-9]|\d{2})$/.test(c.path)))
  const empty = run('empty')
  assert.equal(empty.data.accounts[0].status, 'success')
  assert.equal(empty.data.messages.length, 0)
  console.log(JSON.stringify({ samples, checks: '本文・順序・ページ送り・添付・同時数上限・429時の保存範囲・後続アカウント・空件数: 成功' }))
} finally {
  rmSync(temp, { recursive: true, force: true })
}
