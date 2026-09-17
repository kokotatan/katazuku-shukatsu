import { existsSync, readFileSync, lstatSync } from 'node:fs'
import { resolve } from 'node:path'
import { boundedJson, connectionOrigin } from '../src/http-boundary.js'
import { MAX_SNAPSHOT_BYTES, validateSnapshot } from '../src/snapshot-contract.js'
import { desktopConfig } from '../src/desktop-config.js'

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} が未設定です`)
  return value
}

async function main(): Promise<void> {
  // 手動設定の一部とGUIの設定を混ぜて別の保存先に送らない。
  const manual = ['KATAZUKU_PUSH_URL', 'KATAZUKU_SOURCE_ID', 'KATAZUKU_WRITE_SECRET'].some(name => process.env[name])
  const desktop = manual ? null : desktopConfig()
  const origin = connectionOrigin((desktop?.origin ?? required('KATAZUKU_PUSH_URL')).replace(/\/api\/push$/, ''))
  const sourceId = desktop?.sourceId ?? required('KATAZUKU_SOURCE_ID')
  if (!/^[a-f0-9-]{36}$/.test(sourceId)) throw new Error('正本の識別子を確認してください')
  const file = resolve(process.argv[2] ?? 'data/snapshot.json')
  if (!existsSync(file)) throw new Error('閲覧データがありません。先に npm run snapshot を実行してください')
  const info = lstatSync(file)
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_SNAPSHOT_BYTES) throw new Error('閲覧データのサイズまたは保存形式が不正です')
  const body = readFileSync(file)
  validateSnapshot(JSON.parse(body.toString('utf8')))
  const headers = { Authorization: `Bearer ${desktop?.writeSecret ?? required('KATAZUKU_WRITE_SECRET')}` }
  const options = { redirect: 'error' as const, cache: 'no-store' as const, signal: AbortSignal.timeout(30_000) }
  const stateResponse = await fetch(`${origin}/api/sync-state`, { ...options, headers })
  if (!stateResponse.ok) throw new Error(`保存先の確認に失敗しました: ${stateResponse.status}`)
  const state = await boundedJson(stateResponse, 4096)
  if (!state || typeof state !== 'object' || !('etag' in state) || !('sourceId' in state)
    || !(state.etag === null && state.sourceId === null || typeof state.etag === 'string' && /^"[a-f0-9-]{1,128}"$/.test(state.etag) && state.sourceId === sourceId)) throw new Error('別の正本が同期されているか、保存先の状態を確認できません。送信を停止しました')
  const conditional: Record<string, string> = state.etag === null ? { 'If-None-Match': '*' } : { 'If-Match': state.etag as string }
  const response = await fetch(`${origin}/api/push`, {
    ...options,
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...headers, ...conditional, 'X-Katazuku-Source': sourceId,
    },
    body,
  })
  if (!response.ok) throw new Error(`スナップショット送信に失敗しました: ${response.status}`)
  console.log('本人の保存先へ閲覧データを同期しました')
}

main().catch((error) => {
  console.error(error instanceof Error && !(error instanceof TypeError) && !(error instanceof SyntaxError) ? error.message : '同期できませんでした。接続先と閲覧データを確認してください')
  process.exit(1)
})
