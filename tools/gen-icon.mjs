// アプリアイコン生成(spec16 第一候補): codex側のOpenAI認証で画像API(gpt-image-1)を叩く。
//   node tools/gen-icon.mjs
// 成功: landing/icons/icon-ai-512.png に保存(採用判断は人が見てから)。
// 失敗(ChatGPT OAuthでは画像APIは呼べない等): 理由を表示して終了。
// その場合はフォールバック(tools/gen-icon-fallback.ps1 のteal「片」)を使い続ける。
// トークンは読み込むだけで、画面・ログ・gitに出さない。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

let auth
try {
  auth = JSON.parse(readFileSync(join(homedir(), '.codex', 'auth.json'), 'utf8'))
} catch {
  console.error('~/.codex/auth.json が読めません(codex未ログイン)')
  process.exit(1)
}

const apiKey = typeof auth.OPENAI_API_KEY === 'string' && auth.OPENAI_API_KEY
  ? auth.OPENAI_API_KEY
  : auth.tokens?.access_token
if (!apiKey) {
  console.error('認証情報が見つかりません')
  process.exit(1)
}
console.log(`認証モード: ${auth.auth_mode ?? '不明'}(${typeof auth.OPENAI_API_KEY === 'string' ? 'APIキー' : 'OAuthアクセストークン'}で試行)`)

const prompt = [
  'Minimal flat app icon for a Japanese job-hunting assistant app.',
  'A single white bold Japanese kanji character 片 centered on a solid teal (#00C4CC) background.',
  'Flat design, no gradients, no shadows, no border, square full-bleed, SmartHR-like clean design system style.',
].join(' ')

const res = await fetch('https://api.openai.com/v1/images/generations', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({ model: 'gpt-image-1', prompt, size: '1024x1024', n: 1 }),
})

if (!res.ok) {
  const text = await res.text()
  console.error(`画像API失敗 (${res.status}): ${text.slice(0, 300)}`)
  console.error('→ フォールバック(tools/gen-icon-fallback.ps1 の teal「片」PNG)を使います')
  process.exit(2)
}

const json = await res.json()
const b64 = json.data?.[0]?.b64_json
if (!b64) {
  console.error('画像データがレスポンスにありません')
  process.exit(2)
}
const outDir = join(root, 'landing', 'icons')
mkdirSync(outDir, { recursive: true })
const out = join(outDir, 'icon-ai-512.png')
writeFileSync(out, Buffer.from(b64, 'base64'))
console.log(`生成成功: ${out}(採用するかは見た目を確認してから)`)
