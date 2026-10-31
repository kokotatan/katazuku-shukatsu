import { ImapFlow } from 'imapflow'
import nodemailer from 'nodemailer'
import { actionHash, findSent, readConfig, resolveCredentials, sendMessage, validateRequest } from './lib.mjs'

let raw = ''
for await (const chunk of process.stdin) {
  raw += chunk
  if (Buffer.byteLength(raw) > 4 * 1024 * 1024) throw new Error('adapter requestが大きすぎます')
}

let credentials
try {
  const config = await readConfig(process.env.KATAZUKU_ICLOUD_MAIL_CONFIG || '')
  const request = validateRequest(JSON.parse(raw), config)
  credentials = await resolveCredentials(config)
  if (request.operation === 'reconcile') {
    process.stdout.write(JSON.stringify(await findSent({ ImapFlow, config, credentials, hash: actionHash(request.action) })))
  } else {
    process.stdout.write(JSON.stringify(await sendMessage({ nodemailer, action: request.action, credentials })))
  }
} catch {
  process.stderr.write(JSON.stringify({ status: 'error', message: 'iCloud Mail adapterが失敗しました。秘密値を含まないローカル診断を確認してください' }))
  process.exitCode = 1
} finally {
  if (credentials) { credentials.username = ''; credentials.password = ''; credentials = null }
  raw = ''
}
