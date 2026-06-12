// Discord Webhookに就活メールの要対応通知を送る
// 使い方: node scripts/notify-discord.mjs <items.json>
//   items.json: [{ company, subject, hint, urgency, threadId }]
//   設定: リポジトリ直下の notify-config.json { "webhookUrl": "https://discord.com/api/webhooks/..." }
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

const config = JSON.parse(readFileSync(join(root, 'notify-config.json'), 'utf-8'))
if (!config.webhookUrl) {
  console.error('notify-config.json に webhookUrl がありません')
  process.exit(1)
}

const items = JSON.parse(readFileSync(process.argv[2], 'utf-8'))
if (!Array.isArray(items) || items.length === 0) {
  console.log('通知する項目がありません')
  process.exit(0)
}

const URGENCY_ICON = { overdue: '💀', critical: '🚨', soon: '⏰', normal: '📌' }

const fields = items.slice(0, 10).map((item) => ({
  name: `${URGENCY_ICON[item.urgency] ?? '📌'} ${item.company}`.slice(0, 256),
  value: [
    item.subject,
    item.hint ? `👉 ${item.hint}` : null,
    item.threadId
      ? `[Gmailで開く](https://mail.google.com/mail/u/0/#inbox/${item.threadId})`
      : null,
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 1024),
}))

const overflow = items.length > 10 ? `\n…ほか ${items.length - 10} 件` : ''

const payload = {
  username: 'Katazuku Inbox',
  embeds: [
    {
      title: `🔥 要対応の就活メール ${items.length}件${overflow}`,
      color: 0xe74c3c,
      fields,
      footer: { text: 'Katazuku Inbox — 見逃しゼロ' },
      timestamp: new Date().toISOString(),
    },
  ],
}

const res = await fetch(config.webhookUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
})

if (!res.ok) {
  console.error(`Discord送信失敗: ${res.status} ${await res.text()}`)
  process.exit(1)
}
console.log(`✓ Discordに${items.length}件を通知しました`)
