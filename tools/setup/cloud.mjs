import { spawn } from 'node:child_process'
import { readFile, writeFile, mkdir, rename, access, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { syncToCloud } from './sync.mjs'

/** 所有者が選んだCloudflareアカウントに、この導入専用の保存先を作る。 */
export async function createCloudSetup(root, { execute, fetcher = fetch, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const directory = join(root, 'credentials')
  const statePath = join(directory, 'desktop-cloud.local.json')
  let saved
  try { saved = JSON.parse(await readFile(statePath, 'utf8')) } catch (e) { if (e.code !== 'ENOENT') throw e }
  let progress = { phase: saved?.origin ? 'ready' : 'idle', message: saved?.origin ? '保存先は設定済みです。' : 'Cloudflareで自分専用の保存先を用意します。' }
  let running = false
  let fingerprint = ''
  let syncedAt = null
  let completion = Promise.resolve()
  async function save() { await mkdir(directory, { recursive: true, mode: 0o700 }); const temporary = statePath + '.tmp'; await writeFile(temporary, JSON.stringify(saved), { mode: 0o600 }); await rename(temporary, statePath) }
  function command(args, options = {}) {
    if (execute) return execute(args, options)
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [join(root, 'node_modules/wrangler/bin/wrangler.js'), ...args], { cwd: root, windowsHide: true, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true', ...options.env }, stdio: ['ignore', 'pipe', 'pipe'] })
      let output = '', size = 0
      const timeout = setTimeout(() => { child.kill(); reject(new Error('時間がかかっています。接続を確認して、もう一度お試しください。')) }, 5 * 60_000)
      child.stdout.on('data', chunk => { size += chunk.length; if (size > 2 * 1024 * 1024) child.kill(); else output += chunk })
      // CLIの生出力には認証URLを含むことがある。画面とログには返さない。
      child.stderr.resume()
      child.once('error', () => { clearTimeout(timeout); reject(new Error('PC用アプリの構成を確認できません。展開し直してください。')) })
      child.once('close', code => { clearTimeout(timeout); code === 0 ? resolve(output) : reject(new Error('Cloudflareの設定を完了できませんでした。ログインとR2の利用設定を確認してください。')) })
    })
  }
  async function accounts() {
    try {
      const result = JSON.parse(await command(['whoami', '--json']))
      return (result.accounts || []).filter(account => /^[a-f0-9]{32}$/.test(account.id)).map(account => ({ id: account.id, name: account.name }))
    } catch { return [] }
  }
  async function api(path, method = 'GET', value) {
    const credential = JSON.parse(await command(['auth', 'token', '--json']))
    if (typeof credential.token !== 'string') throw new Error('Cloudflareへログインし直してください。')
    const response = await fetcher('https://api.cloudflare.com/client/v4' + path, { method, headers: { Authorization: 'Bearer ' + credential.token, 'Content-Type': 'application/json' }, ...(value ? { body: JSON.stringify(value) } : {}), redirect: 'error', signal: AbortSignal.timeout(30_000) })
    const reader = response.body.getReader(); const chunks = []; let size = 0
    try { while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > 1_048_576) { await reader.cancel(); throw new Error('Cloudflareの応答が大きすぎます。') }; chunks.push(chunk.value) } } finally { reader.releaseLock() }
    const text = Buffer.concat(chunks).toString('utf8')
    const result = JSON.parse(text)
    if (!response.ok && response.status !== 404) throw new Error('Cloudflareの操作権限または利用設定を確認してください。')
    return { status: response.status, result: result.result }
  }
  function background(operation) {
    if (running) throw new Error('処理中です。少し待ってください。')
    running = true
    completion = operation().catch(error => { progress = { phase: 'error', message: error.message } }).finally(() => { running = false })
  }
  function login() { background(async () => { progress = { phase: 'login', message: 'ブラウザーでCloudflareにログインし、権限を確認してください。' }; await command(['login']); progress = { phase: 'select', message: '保存先を作るアカウントを選んでください。' } }) }
  async function databaseFingerprint() {
    const stamps = await Promise.all([saved.database, saved.database + '-wal'].map(async path => {
      try { const info = await stat(path); return path.endsWith('-wal') && info.size === 0 ? 'missing' : `${info.size}:${info.mtimeMs}` } catch (e) { if (e.code === 'ENOENT') return 'missing'; throw e }
    }))
    return stamps.join('|')
  }
  async function synchronize({ createDatabase = false, origin = saved?.origin } = {}) {
    const before = await databaseFingerprint()
    const result = await syncToCloud(root, { ...saved, origin }, { fetcher, createDatabase })
    syncedAt = result.syncedAt
    // 同期中に書き込みが入った場合は、次回も評価する。
    fingerprint = before
    progress = { phase: 'ready', message: 'このPCの記録を同期しました。' }
  }
  function sync() {
    if (!saved?.origin) throw new Error('先に保存先の設定を完了してください。')
    background(async () => { progress = { phase: 'syncing', message: 'このPCの記録を同期しています…' }; await synchronize() })
  }
  async function syncIfChanged() {
    if (running || !saved?.origin) return
    if (await databaseFingerprint() !== fingerprint) { sync(); await completion }
  }
  function create({ accountId, deviceName, dataFolder }) {
    if (!/^[a-f0-9]{32}$/.test(accountId || '') || !deviceName?.trim() || deviceName.length > 80 || typeof dataFolder !== 'string' || !dataFolder.trim()) throw new Error('アカウントと保存フォルダを確認してください。')
    background(async () => {
      if (!(await accounts()).some(account => account.id === accountId)) throw new Error('選択したCloudflareアカウントを確認できません。')
      if (saved && saved.accountId !== accountId) throw new Error('作成途中の保存先があります。同じアカウントで再開してください。')
      await access(join(root, 'web-dist', 'status', 'index.html'))
      const database = join(resolve(dataFolder), 'katazuku.db')
      if (saved && saved.database !== database) throw new Error('作成途中の保存フォルダを変更できません。同じ保存先で再開してください。')
      if (!saved) { const name = 'katazuku-' + randomBytes(8).toString('hex'); saved = { accountId, name, database, deviceName: deviceName.trim(), readSecret: randomBytes(32).toString('base64url'), writeSecret: randomBytes(32).toString('base64url'), sourceId: randomUUID() }; await save() }
      progress = { phase: 'creating', message: '自分専用の保存先を用意しています…' }
      const base = '/accounts/' + accountId
      if (!saved.bucketCreated) {
        const existing = await api(base + '/r2/buckets/' + saved.name)
        if (existing.status !== 404) throw new Error('同名の保存先が見つかりました。既存データを保護するため停止しました。')
        await api(base + '/r2/buckets', 'POST', { name: saved.name }); saved.bucketCreated = true; await save()
      }
      const configFile = join(directory, 'desktop-worker.local.json')
      const secretsFile = join(directory, 'desktop-secrets.local.json')
      const origin = await api(base + '/workers/subdomain')
      if (!/^[a-z0-9-]+$/.test(origin.result?.subdomain || '')) throw new Error('Cloudflareの画面でworkers.devのアドレスを設定してください。')
      const appOrigin = 'https://' + saved.name + '.' + origin.result.subdomain + '.workers.dev'
      if (!saved.deployed) {
        const existing = await api(base + '/workers/scripts/' + saved.name + '/settings')
        if (existing.status !== 404) throw new Error('同名のアプリが見つかりました。既存のアプリを上書きせず停止しました。')
        const config = { name: saved.name, account_id: accountId, main: join(root, 'cloudflare/worker.ts'), compatibility_date: '2026-09-07', compatibility_flags: ['nodejs_compat'], workers_dev: true,
          assets: { directory: join(root, 'web-dist'), binding: 'ASSETS', run_worker_first: true },
          r2_buckets: [{ binding: 'PRIVATE_DATA', bucket_name: saved.name }], vars: { KATAZUKU_DEVICE_NAME: saved.deviceName, KATAZUKU_ALLOWED_ORIGINS: '' },
          ratelimits: [{ name: 'AUTH_LIMIT', namespace_id: '1001', simple: { limit: 10, period: 60 } }, { name: 'REQUEST_LIMIT', namespace_id: '1002', simple: { limit: 120, period: 60 } }], observability: { enabled: false } }
        await writeFile(configFile, JSON.stringify(config)); await writeFile(secretsFile, JSON.stringify({ KATAZUKU_READ_SECRET: saved.readSecret, KATAZUKU_WRITE_SECRET: saved.writeSecret }), { mode: 0o600 })
        await command(['deploy', '--config', configFile, '--secrets-file', secretsFile]); saved.deployed = true; await save()
      }
      progress = { phase: 'checking', message: '保存先とPCの接続を確認しています…' }
      // 新しいworkers.devアドレスはデプロイ完了直後に404になることがある。
      // 応答が届くまで待ち、本人確認と初回同期はその後に一度だけ行う。
      let readyCount = 0
      for (let attempt = 0; attempt < 24; attempt++) {
        const ready = await fetcher(appOrigin + '/api/info', { redirect: 'error', signal: AbortSignal.timeout(15_000) })
        await ready.body?.cancel()
        const authenticated = ready.ok ? await fetcher(appOrigin + '/api/sync-state', { headers: { Authorization: 'Bearer ' + saved.writeSecret }, redirect: 'error', signal: AbortSignal.timeout(15_000) }) : null
        await authenticated?.body?.cancel()
        const status = authenticated?.status || ready.status
        readyCount = status === 200 ? readyCount + 1 : 0
        if (readyCount >= 3) break
        if (![200, 401, 404, 502, 503].includes(status) || attempt === 23) throw new Error('保存先の公開反映を待っています。同じ設定で、少し後にやり直してください。')
        await pause(5000)
      }
      await synchronize({ createDatabase: true, origin: appOrigin })
      saved.origin = appOrigin; await save()
      progress = { phase: 'ready', message: '自分専用の保存先を用意しました。パスワードを設定してください。' }
    })
  }
  return { accounts, login, create, sync, syncIfChanged, getStatus: () => ({ ...progress, running, syncedAt }), getConfig: () => saved, whenIdle: () => completion }
}
