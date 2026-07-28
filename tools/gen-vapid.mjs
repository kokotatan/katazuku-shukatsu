// VAPID鍵を生成して .env に追記する(秘密鍵は画面に出さない)
// 使い方: node tools/gen-vapid.mjs
// 既に KATAZUKU_VAPID_PUBLIC_KEY がある場合は何もしない(上書き防止)
import webpush from 'web-push'
import { readFileSync, appendFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const envPath = join(root, '.env')
const current = existsSync(envPath) ? readFileSync(envPath, 'utf8') : ''
if (current.includes('KATAZUKU_VAPID_PUBLIC_KEY=')) {
  const pub = current.match(/^KATAZUKU_VAPID_PUBLIC_KEY=(.+)$/m)?.[1]?.trim()
  console.log('既に生成済み。public key:', pub)
  process.exit(0)
}

const { publicKey, privateKey } = webpush.generateVAPIDKeys()
const lines = [
  '',
  '# Web Push (spec16)。秘密鍵は絶対にコミット・出力しない',
  `KATAZUKU_VAPID_PUBLIC_KEY=${publicKey}`,
  `KATAZUKU_VAPID_PRIVATE_KEY=${privateKey}`,
  'KATAZUKU_VAPID_SUBJECT=mailto:okuyama.kotaro.career@gmail.com',
  '',
].join('\n')
appendFileSync(envPath, lines)
console.log('.env に追記しました。public key:', publicKey)
