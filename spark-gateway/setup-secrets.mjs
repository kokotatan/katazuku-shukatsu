import { randomBytes, createHash } from 'node:crypto'
import { writeFileSync, existsSync } from 'node:fs'
// 生成値を標準出力へ出さない。実環境への投入は wrangler secret bulk のみ。
if (existsSync('secrets.local.json') || existsSync('owner-key.local.txt')) throw new Error('既存キーを自動更新しません')
const ownerKey = randomBytes(32).toString('base64url')
const bridgeToken = randomBytes(32).toString('base64url')
writeFileSync('owner-key.local.txt', ownerKey, { mode: 0o600 })
writeFileSync('secrets.local.json', JSON.stringify({ OWNER_KEY_SHA256: createHash('sha256').update(ownerKey).digest('hex'), BRIDGE_TOKEN: bridgeToken }), { mode: 0o600 })
console.log('専用キーをgit対象外のローカルファイルへ保存しました')
