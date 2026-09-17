import { access, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

/** 画面で選んだ正本から、本人確認済みの保存先にだけ同期する。 */
export async function syncToCloud(root, config, { fetcher = fetch, createDatabase = false } = {}) {
  const { connectionOrigin, boundedJson } = await import(pathToFileURL(join(root, 'dist/http-boundary.js')).href)
  const { buildSnapshot } = await import(pathToFileURL(join(root, 'dist/snapshot.js')).href)
  const { MAX_SNAPSHOT_BYTES, validateSnapshot } = await import(pathToFileURL(join(root, 'dist/snapshot-contract.js')).href)
  const origin = connectionOrigin(config.origin)
  if (!/^[a-f0-9-]{36}$/.test(config.sourceId || '') || !config.writeSecret || !config.readSecret || !config.database) throw new Error('PCの保存先を設定し直してください。')
  const options = () => ({ redirect: 'error', signal: AbortSignal.timeout(30_000) })
  const infoResponse = await fetcher(origin + '/api/info', options())
  if (!infoResponse.ok) throw new Error('保存先へ接続できません。')
  const info = await boundedJson(infoResponse, 4096)
  const expected = createHash('sha256').update('katazuku-v1\0' + origin + '\0' + config.readSecret).digest('hex').slice(0, 32)
  if (info?.instanceId !== expected) throw new Error('保存先の本人確認に失敗しました。同期を開始せず停止しました。')
  let exists = true
  try { await access(config.database) } catch (e) { if (e.code === 'ENOENT') exists = false; else throw e }
  if (!exists && !createDatabase) throw new Error('記録の保存フォルダが見つかりません。PCの設定を確認してください。')
  // 初回作成以外は読み取り専用。別用途のDBや既存スキーマを変更しない。
  const db = exists ? new DatabaseSync(config.database, { readOnly: true }) : (await import(pathToFileURL(join(root, 'dist/db.js')).href)).openDb(config.database)
  let snapshot
  try { db.exec('BEGIN'); snapshot = buildSnapshot(db); db.exec('COMMIT') } finally { db.close() }
  validateSnapshot(snapshot)
  const body = JSON.stringify(snapshot)
  if (Buffer.byteLength(body) > MAX_SNAPSHOT_BYTES) throw new Error('同期できるデータのサイズを超えています。記録はPCに残っています。')
  const headers = { Authorization: 'Bearer ' + config.writeSecret }
  const response = await fetcher(origin + '/api/sync-state', { ...options(), headers })
  if (!response.ok) throw new Error('保存先の同期状態を確認できません。')
  const state = await boundedJson(response, 4096)
  if (!state || !(state.etag === null && state.sourceId === null || typeof state.etag === 'string' && /^"[a-f0-9-]{1,128}"$/.test(state.etag) && state.sourceId === config.sourceId)) throw new Error('別のPCの記録が保存されているか、同期状態を確認できません。上書きせず停止しました。')
  const pushed = await fetcher(origin + '/api/push', { ...options(), method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json', 'X-Katazuku-Source': config.sourceId, ...(state.etag ? { 'If-Match': state.etag } : { 'If-None-Match': '*' }) }, body })
  if (!pushed.ok) throw new Error('同期を完了できません。記録はPCに残っています。時間をおいて再試行してください。')
  return { syncedAt: new Date().toISOString() }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(import.meta.dirname, '../..')
  try {
    const config = JSON.parse(await readFile(join(root, 'credentials/desktop-cloud.local.json'), 'utf8'))
    await syncToCloud(root, config)
    console.log('このPCの記録を、本人の保存先へ同期しました。')
  } catch {
    console.error('同期できませんでした。「katazukuの設定」で保存フォルダと接続状態を確認してください。')
    process.exitCode = 1
  }
}
