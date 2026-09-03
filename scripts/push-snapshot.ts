import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} が未設定です`)
  return value
}

async function main(): Promise<void> {
  const base = required('KATAZUKU_PUSH_URL')
  const endpoint = base.endsWith('/api/push') ? base : `${base.replace(/\/$/, '')}/api/push`
  const url = new URL(endpoint)
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('KATAZUKU_PUSH_URL は https または localhost を指定してください')
  }
  const file = resolve(process.argv[2] ?? 'board/public/snapshot.json')
  if (!existsSync(file)) throw new Error(`${file} がありません。先に npm run snapshot を実行してください`)
  const body = readFileSync(file)
  const response = await fetch(endpoint, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${required('KATAZUKU_WRITE_SECRET')}`,
    },
    body,
  })
  if (!response.ok) throw new Error(`スナップショット送信に失敗しました: ${response.status}`)
  console.log(`スナップショットを ${url.origin} へ送信しました`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
