/**
 * data/private/photos の写真を認証付きAPI経由で非公開オブジェクトストレージへ同期する。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PHOTO_ROOT = join(ROOT, 'data', 'private', 'photos')

function loadEnv(): Record<string, string> {
  const file = join(ROOT, '.env')
  if (!existsSync(file)) return {}
  const result: Record<string, string> = {}
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (match) result[match[1]] = match[2].replace(/^["']|["']$/g, '')
  }
  return result
}

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
}

function contentType(file: string): string {
  const ext = extname(file).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  return 'image/jpeg'
}

async function main(): Promise<void> {
  const env = loadEnv()
  const secret = process.env.KATAZUKU_WRITE_SECRET || env.KATAZUKU_WRITE_SECRET
  const snapshotUrl = process.env.KATAZUKU_PUSH_URL || env.KATAZUKU_PUSH_URL || 'https://katazuku.kotalabo.com/api/push'
  const endpoint = snapshotUrl.replace(/\/api\/push(?:\?.*)?$/, '/api/photo-push')
  if (!secret) {
    console.log('KATAZUKU_WRITE_SECRET が無いため写真同期をスキップ')
    return
  }
  let uploaded = 0
  for (const file of filesUnder(PHOTO_ROOT)) {
    const storageKey = relative(PHOTO_ROOT, file).replace(/\\/g, '/')
    const bytes = readFileSync(file)
    const response = await fetch(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify({
        storageKey,
        contentBase64: bytes.toString('base64'),
        contentType: contentType(file),
      }),
    })
    if (!response.ok) throw new Error(`写真同期失敗 ${storageKey}: ${response.status} ${(await response.text()).slice(0, 120)}`)
    uploaded += 1
  }
  console.log(`写真同期完了: ${uploaded}件`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
