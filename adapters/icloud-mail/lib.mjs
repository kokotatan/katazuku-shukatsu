import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_BROKER_OUTPUT = 16 * 1024

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}が不正です`)
  return value
}

function exactKeys(value, allowed, label) {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key))
  if (extras.length) throw new Error(`${label}に未知の項目があります`)
}

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}

export function actionHash(action) {
  return createHash('sha256').update(canonicalJson(action)).digest('hex')
}

export function validateConfig(value) {
  const config = record(value, 'iCloud設定')
  exactKeys(config, ['version', 'senderEmail', 'credentialBroker', 'sentMailbox'], 'iCloud設定')
  if (config.version !== 1 || typeof config.senderEmail !== 'string' || !EMAIL.test(config.senderEmail)) throw new Error('iCloud設定の送信元が不正です')
  const broker = record(config.credentialBroker, 'credentialBroker')
  exactKeys(broker, ['executable', 'args'], 'credentialBroker')
  if (typeof broker.executable !== 'string' || !isAbsolute(broker.executable)) throw new Error('credential brokerは絶対パスで指定してください')
  if (!Array.isArray(broker.args) || broker.args.some((item) => typeof item !== 'string' || /[\r\n\0]/.test(item))) throw new Error('credential brokerの引数が不正です')
  if (config.sentMailbox !== undefined && (typeof config.sentMailbox !== 'string' || !config.sentMailbox.trim() || config.sentMailbox.length > 256)) throw new Error('送信済みmailboxが不正です')
  return {
    version: 1,
    senderEmail: config.senderEmail.toLowerCase(),
    credentialBroker: { executable: broker.executable, args: [...broker.args] },
    ...(config.sentMailbox ? { sentMailbox: config.sentMailbox } : {}),
  }
}

export async function readConfig(path) {
  if (!isAbsolute(path)) throw new Error('iCloud設定は絶対パスで指定してください')
  return validateConfig(JSON.parse(await readFile(path, 'utf8')))
}

export function validateRequest(value, config) {
  const request = record(value, 'adapter request')
  exactKeys(request, ['operation', 'action'], 'adapter request')
  if (!['reconcile', 'send'].includes(request.operation)) throw new Error('adapter operationが不正です')
  const action = record(request.action, 'email action')
  const target = record(action.target, 'email target')
  if (action.actionType !== 'email.send' || target.provider !== 'icloud-mail'
    || String(target.senderEmail || '').toLowerCase() !== config.senderEmail) {
    throw new Error('iCloud Mail用に固定されたactionではありません')
  }
  if (!Array.isArray(target.to) || !target.to.length || [...target.to, ...(target.cc || []), ...(target.bcc || [])].some((item) => typeof item !== 'string' || !EMAIL.test(item))) {
    throw new Error('送信先が不正です')
  }
  const content = record(action.content, 'email content')
  if (typeof content.subject !== 'string' || !content.subject || typeof content.body !== 'string' || !content.body) throw new Error('件名または本文が不正です')
  return { operation: request.operation, action }
}

export async function resolveCredentials(config) {
  return new Promise((resolve, reject) => {
    const child = spawn(config.credentialBroker.executable, config.credentialBroker.args, {
      shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
      env: { SYSTEMROOT: process.env.SYSTEMROOT || '', WINDIR: process.env.WINDIR || '', PATH: process.env.PATH || '', TEMP: process.env.TEMP || '', TMP: process.env.TMP || '' },
    })
    let output = Buffer.alloc(0)
    child.stdout.on('data', (chunk) => {
      output = Buffer.concat([output, chunk])
      if (output.length > MAX_BROKER_OUTPUT) child.kill()
    })
    child.on('error', () => reject(new Error('credential brokerを起動できません')))
    child.on('close', (code) => {
      if (code !== 0 || output.length > MAX_BROKER_OUTPUT) return reject(new Error('credential brokerから資格情報を取得できません'))
      try {
        const value = record(JSON.parse(output.toString('utf8')), 'credential broker応答')
        exactKeys(value, ['username', 'password'], 'credential broker応答')
        if (typeof value.username !== 'string' || !value.username.trim() || typeof value.password !== 'string' || !value.password) throw new Error('invalid')
        resolve({ username: value.username, password: value.password })
      } catch { reject(new Error('credential brokerの応答が不正です')) }
    })
  })
}

export function buildMessage(action) {
  const hash = actionHash(action)
  return {
    hash,
    message: {
      from: action.target.senderEmail,
      to: action.target.to,
      ...(action.target.cc?.length ? { cc: action.target.cc } : {}),
      ...(action.target.bcc?.length ? { bcc: action.target.bcc } : {}),
      subject: action.content.subject,
      text: action.content.body,
      messageId: `<${hash}@katazuku.invalid>`,
      ...(action.content.inReplyTo ? { inReplyTo: action.content.inReplyTo } : {}),
      ...(action.content.references ? { references: action.content.references } : {}),
      headers: { 'X-Katazuku-Action-Hash': hash },
      attachments: (action.content.attachments || []).map((item) => ({ path: item.path, filename: item.filename, contentType: item.mimeType })),
    },
  }
}

export async function findSent({ ImapFlow, config, credentials, hash }) {
  const client = new ImapFlow({
    host: 'imap.mail.me.com', port: 993, secure: true,
    auth: { user: credentials.username, pass: credentials.password }, logger: false,
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    connectionTimeout: 20_000, greetingTimeout: 20_000, socketTimeout: 30_000,
  })
  let connectionError = false
  client.on('error', () => { connectionError = true })
  try {
    await client.connect()
    const mailboxes = await client.list()
    const sent = config.sentMailbox || mailboxes.find((item) => item.specialUse === '\\Sent')?.path
    if (!sent) return { state: 'unknown' }
    const lock = await client.getMailboxLock(sent, { readOnly: true })
    try {
      const result = await client.search({ header: { 'X-Katazuku-Action-Hash': hash } }, { uid: true })
      if (connectionError || result === false || result === undefined || !Array.isArray(result)) return { state: 'unknown' }
      if (!result.length) return { state: 'not_sent' }
      return { state: 'sent', receiptRef: `icloud-imap:${sent}:${Math.max(...result)}` }
    } finally { lock.release() }
  } finally {
    try { await client.logout() } catch { client.close() }
  }
}

export async function sendMessage({ nodemailer, action, credentials }) {
  const { message } = buildMessage(action)
  const transport = nodemailer.createTransport({
    host: 'smtp.mail.me.com', port: 587, secure: false, requireTLS: true,
    auth: { user: credentials.username, pass: credentials.password },
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    connectionTimeout: 20_000, greetingTimeout: 20_000, socketTimeout: 30_000,
  })
  const info = await transport.sendMail(message)
  const expected = new Set([...action.target.to, ...(action.target.cc || []), ...(action.target.bcc || [])].map((item) => item.toLowerCase()))
  const accepted = new Set((info.accepted || []).map((item) => String(item).toLowerCase()))
  if ([...expected].some((item) => !accepted.has(item))) throw new Error('SMTPが全送信先を受理しませんでした')
  return { accepted: true }
}

export function validateInboxQuery(value) {
  const query = record(value, 'inbox query')
  exactKeys(query, ['from', 'subject', 'since', 'unseen', 'limit'], 'inbox query')
  if (query.from !== undefined && (typeof query.from !== 'string' || !EMAIL.test(query.from))) throw new Error('fromが不正です')
  if (query.subject !== undefined && (typeof query.subject !== 'string' || !query.subject.trim() || query.subject.length > 200)) throw new Error('subjectが不正です')
  if (query.since !== undefined && (typeof query.since !== 'string' || !Number.isFinite(Date.parse(query.since)))) throw new Error('sinceが不正です')
  if (query.unseen !== undefined && typeof query.unseen !== 'boolean') throw new Error('unseenが不正です')
  const limit = query.limit ?? 20
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error('limitが不正です')
  if (!query.from && !query.subject && !query.since && query.unseen === undefined) throw new Error('inbox queryには絞り込みが必要です')
  return { ...(query.from ? { from: query.from } : {}), ...(query.subject ? { subject: query.subject } : {}), ...(query.since ? { since: new Date(query.since) } : {}), ...(query.unseen !== undefined ? { seen: !query.unseen } : {}), limit }
}

function addressValues(value) {
  return (value?.value || []).flatMap((item) => item.address ? [{ name: String(item.name || ''), address: String(item.address).toLowerCase() }] : [])
}

function authMessage(subject, text, headers) {
  if (headers?.has?.('otp-token')) return true
  const sample = `${subject}\n${text}`
  return /(?:one[- ]?time|verification|security|認証|確認|ワンタイム).{0,40}(?:code|コード|passcode|パスコード)/isu.test(sample)
    && /\b\d{4,8}\b/.test(sample)
}

export async function searchInbox({ ImapFlow, simpleParser, credentials, query }) {
  const { limit, ...criteria } = validateInboxQuery(query)
  const client = new ImapFlow({
    host: 'imap.mail.me.com', port: 993, secure: true,
    auth: { user: credentials.username, pass: credentials.password }, logger: false,
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    connectionTimeout: 20_000, greetingTimeout: 20_000, socketTimeout: 30_000,
  })
  let connectionError = false
  client.on('error', () => { connectionError = true })
  try {
    await client.connect()
    const lock = await client.getMailboxLock('INBOX', { readOnly: true })
    try {
      const found = await client.search(criteria, { uid: true })
      if (connectionError || !Array.isArray(found)) throw new Error('iCloud IMAPの検索結果を確定できません')
      const selected = found.slice(-limit).reverse()
      const messages = []
      for (const uid of selected) {
        const metadata = await client.fetchOne(uid, { envelope: true, size: true }, { uid: true })
        if (!metadata) continue
        const base = {
          uid,
          sourceRef: `icloud:INBOX:${uid}`,
          messageId: String(metadata.envelope?.messageId || ''),
          date: metadata.envelope?.date instanceof Date ? metadata.envelope.date.toISOString() : String(metadata.envelope?.date || ''),
          subject: String(metadata.envelope?.subject || ''),
          from: (metadata.envelope?.from || []).map((item) => ({ name: String(item.name || ''), address: String(item.address || '').toLowerCase() })),
          to: (metadata.envelope?.to || []).map((item) => ({ name: String(item.name || ''), address: String(item.address || '').toLowerCase() })),
          size: Number(metadata.size || 0),
        }
        if (!metadata.size || metadata.size > 1024 * 1024) {
          messages.push({ ...base, text: '', truncated: true, sensitiveAuthentication: false, attachments: [] })
          continue
        }
        const rawMessage = await client.fetchOne(uid, { source: true }, { uid: true })
        if (!rawMessage?.source) { messages.push({ ...base, text: '', truncated: true, sensitiveAuthentication: false, attachments: [] }); continue }
        const parsed = await simpleParser(rawMessage.source, { skipHtmlToText: false, skipTextToHtml: true, skipImageLinks: true, maxHtmlLengthToParse: 1024 * 1024 })
        const text = String(parsed.text || '').slice(0, 200_000)
        const sensitiveAuthentication = authMessage(base.subject, text, parsed.headers)
        messages.push({
          ...base,
          from: addressValues(parsed.from).length ? addressValues(parsed.from) : base.from,
          to: addressValues(parsed.to).length ? addressValues(parsed.to) : base.to,
          replyTo: addressValues(parsed.replyTo),
          text: sensitiveAuthentication ? '' : text,
          truncated: text.length >= 200_000,
          sensitiveAuthentication,
          inReplyTo: String(parsed.inReplyTo || ''),
          references: Array.isArray(parsed.references) ? parsed.references.map(String) : parsed.references ? [String(parsed.references)] : [],
          attachments: (parsed.attachments || []).map((item) => ({ filename: String(item.filename || ''), mimeType: String(item.contentType || ''), size: Number(item.size || 0) })),
        })
      }
      return messages
    } finally { lock.release() }
  } finally {
    try { await client.logout() } catch { client.close() }
  }
}
