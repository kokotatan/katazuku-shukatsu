// Web Push手動送信(spec16の垂直スライス2)。デプロイ済みの /api/push-send を叩く。
//   node scripts/push-send.mjs --title "katazuku" --body "テスト通知です" --url /insight/
//   node scripts/push-send.mjs --base https://<preview-host> --body "..."
// 認証は repo直下 .env の KATAZUKU_WRITE_SECRET(db-snapshot.tsと同じ)。
// 通知本文はロック画面に出るため、企業名・個人名を細かく載せない(要約レベル)。
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

function loadEnv() {
  const out = {}
  const p = join(root, '.env')
  if (!existsSync(p)) return out
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) out[m[1]] = m[2].trim()
  }
  return out
}

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const env = loadEnv()
const secret = process.env.KATAZUKU_WRITE_SECRET ?? env.KATAZUKU_WRITE_SECRET
if (!secret) {
  console.error('KATAZUKU_WRITE_SECRET が .env にありません')
  process.exit(1)
}
const base = arg('base', 'https://katazuku.kotalabo.com')
const payload = {
  title: arg('title', 'katazuku'),
  body: arg('body', ''),
  url: arg('url', '/insight/'),
}

const res = await fetch(`${base}/api/push-send`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
  body: JSON.stringify(payload),
})
const text = await res.text()
if (!res.ok) {
  console.error(`送信失敗 (${res.status}): ${text.slice(0, 300)}`)
  process.exit(1)
}
console.log(`送信結果: ${text}`)
