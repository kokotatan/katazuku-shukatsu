import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { readConfig, resolveCredentials, searchInbox } from './lib.mjs'

let raw = ''
let credentials
try {
  for await (const chunk of process.stdin) {
    raw += chunk
    if (Buffer.byteLength(raw) > 64 * 1024) throw new Error('inbox queryが大きすぎます')
  }
  const config = await readConfig(process.env.KATAZUKU_ICLOUD_MAIL_CONFIG || '')
  credentials = await resolveCredentials(config)
  const input = JSON.parse(raw)
  const messages = await searchInbox({ ImapFlow, simpleParser, credentials, query: input.query })
  process.stdout.write(JSON.stringify({ messages }))
} catch {
  process.stderr.write(JSON.stringify({ status: 'error', message: 'iCloud受信メールの取得に失敗しました。秘密値を含まないローカル診断を確認してください' }))
  process.exitCode = 1
} finally {
  if (credentials) { credentials.username = ''; credentials.password = ''; credentials = null }
  raw = ''
}
