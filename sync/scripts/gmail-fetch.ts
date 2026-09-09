/**
 * GmailをLLM/MCPなしで読み取り、daily-sync抽出用のローカルJSONへ保存する。
 * ラベル変更、既読化、下書き、送信は一切行わない。障害復旧バックフィルにも使う。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const DEFAULT_ACCOUNTS = [
  'okuyama.kotaro.career@gmail.com',
  'okuyama.kotaro@gmail.com',
  'okuyama.kotaro.robotics@gmail.com',
  'okuyama.kotaro.p3@dc.tohoku.ac.jp',
]
const ACCOUNTS = process.env.KATAZUKU_GMAIL_ACCOUNTS
  ? process.env.KATAZUKU_GMAIL_ACCOUNTS.split(',').map((item) => item.trim()).filter(Boolean)
  : DEFAULT_ACCOUNTS

interface StoredToken {
  refresh_token: string
  client_id: string
  client_secret: string
  token_uri?: string
}

interface GmailPart {
  mimeType?: string
  filename?: string
  body?: { attachmentId?: string; data?: string; size?: number }
  parts?: GmailPart[]
}

interface GmailMessage {
  id: string
  threadId: string
  internalDate?: string
  snippet?: string
  payload?: GmailPart & { headers?: { name: string; value: string }[] }
}

async function getAccessToken(account: string): Promise<string> {
  const path = join(process.env.USERPROFILE || process.env.HOME || '', '.google_workspace_mcp', 'credentials', `${account}.json`)
  const stored = JSON.parse(readFileSync(path, 'utf8')) as StoredToken
  if (!stored.refresh_token) throw new Error('refresh_tokenがありません')
  const response = await fetch(stored.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: stored.client_id,
      client_secret: stored.client_secret,
      refresh_token: stored.refresh_token,
      grant_type: 'refresh_token',
    }),
  })
  if (!response.ok) throw new Error(`アクセストークン取得失敗(HTTP ${response.status})`)
  const result = await response.json() as { access_token?: string }
  if (!result.access_token) throw new Error('access_tokenがありません')
  return result.access_token
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(normalized, 'base64').toString('utf8')
}

function stripHtml(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/div>|<\/tr>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function collectText(part: GmailPart | undefined): { plain: string[]; html: string[] } {
  const out = { plain: [] as string[], html: [] as string[] }
  if (!part) return out
  if (!part.filename && part.body?.data) {
    const value = decodeBase64Url(part.body.data)
    if (part.mimeType === 'text/plain') out.plain.push(value)
    else if (part.mimeType === 'text/html') out.html.push(stripHtml(value))
  }
  for (const child of part.parts || []) {
    const nested = collectText(child)
    out.plain.push(...nested.plain)
    out.html.push(...nested.html)
  }
  return out
}

function collectAttachments(part: GmailPart | undefined): { filename: string; mimeType: string; size: number; attachmentId: string }[] {
  if (!part) return []
  const out = part.filename
    ? [{
        filename: part.filename,
        mimeType: part.mimeType || 'application/octet-stream',
        size: part.body?.size || 0,
        attachmentId: part.body?.attachmentId || '',
      }]
    : []
  for (const child of part.parts || []) out.push(...collectAttachments(child))
  return out
}

function header(message: GmailMessage, name: string): string {
  return message.payload?.headers?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value || ''
}

async function listMessageIds(token: string, query: string): Promise<string[]> {
  const ids: string[] = []
  let pageToken = ''
  do {
    const params = new URLSearchParams({ q: query, maxResults: '100' })
    if (pageToken) params.set('pageToken', pageToken)
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) throw new Error(`Gmail検索失敗(HTTP ${response.status})`)
    const result = await response.json() as { messages?: { id: string }[]; nextPageToken?: string }
    ids.push(...(result.messages || []).map((item) => item.id))
    pageToken = result.nextPageToken || ''
  } while (pageToken && ids.length < 500)
  return ids.slice(0, 500)
}

async function getMessage(token: string, id: string): Promise<GmailMessage> {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error(`Gmail本文取得失敗(${id}: HTTP ${response.status})`)
  return response.json() as Promise<GmailMessage>
}

async function* getMessages(token: string, ids: string[]): AsyncGenerator<GmailMessage> {
  // 読取だけを最大5件ずつ先行させる。本文・添付の保存順は検索結果の順を維持する。
  for (let offset = 0; offset < ids.length; offset += 5) {
    const results = await Promise.allSettled(ids.slice(offset, offset + 5).map((id) => getMessage(token, id)))
    for (const result of results) {
      // 全リクエストの終了を待ち、最初の失敗以降は従来どおり保存しない。
      // 失敗したアカウントでは次のバッチを開始しない。
      if (result.status === 'rejected') throw result.reason
      yield result.value
    }
  }
}

async function downloadAttachment(token: string, messageId: string, attachmentId: string): Promise<Buffer> {
  const response = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!response.ok) throw new Error(`Gmail添付取得失敗(${messageId}: HTTP ${response.status})`)
  const result = await response.json() as { data?: string }
  if (!result.data) throw new Error(`Gmail添付データがありません(${messageId})`)
  return Buffer.from(result.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

async function main() {
  const args = process.argv.slice(2)
  const outputPath = resolve((args[0] && !args[0].startsWith('--') ? args[0] : '') || join(REPO, 'sync', 'gmail-backfill-loop.json'))
  const option = (name: string) => {
    const index = args.indexOf(name)
    return index >= 0 ? args[index + 1] : undefined
  }
  const daysIndex = args.indexOf('--days')
  const days = daysIndex >= 0 ? Number(args[daysIndex + 1]) : 1
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error('--daysは1〜30です')
  const after = option('--after')
  const before = option('--before')
  const customQuery = option('--query')
  const downloadMessage = option('--download-message')
  const downloadDir = option('--download-dir')
  if ((downloadMessage && !downloadDir) || (!downloadMessage && downloadDir)) {
    throw new Error('--download-messageと--download-dirは同時に指定してください')
  }
  for (const [name, value] of [['--after', after], ['--before', before]] as const) {
    if (value && !/^\d{4}[/-]\d{2}[/-]\d{2}$/.test(value)) throw new Error(`${name}はYYYY-MM-DDです`)
  }
  const terms = [
    '選考', '面接', '面談', '採用', 'インターン', 'エントリー', '説明会', '適性検査',
    'エントリーシート', 'オファー', '内定', '不合格', 'お見送り', '書類', '提出', '締切',
    '保険', '証明書', '学研災', '学研賠',
    'Slack', 'ワークスペース', 'キックオフ', '交通費', '宿泊', '合格', '結果',
  ]
  const dateQuery = after
    ? `after:${after.replace(/-/g, '/')} ${before ? `before:${before.replace(/-/g, '/')}` : ''}`.trim()
    : `newer_than:${days}d`
  const query = customQuery || `${dateQuery} {${terms.join(' ')}}`
  const messages: unknown[] = []
  const accounts: unknown[] = []
  for (const account of ACCOUNTS) {
    try {
      const token = await getAccessToken(account)
      const ids = await listMessageIds(token, query)
      for await (const message of getMessages(token, ids)) {
        const text = collectText(message.payload)
        const attachments = collectAttachments(message.payload)
        const downloadedAttachments: { filename: string; path: string }[] = []
        if (downloadMessage === message.id && downloadDir) {
          const targetDir = resolve(downloadDir)
          mkdirSync(targetDir, { recursive: true })
          for (const [index, attachment] of attachments.entries()) {
            if (!attachment.attachmentId) continue
            const safeName = basename(attachment.filename).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_') || `attachment-${index + 1}`
            const targetPath = join(targetDir, safeName)
            writeFileSync(targetPath, await downloadAttachment(token, message.id, attachment.attachmentId))
            downloadedAttachments.push({ filename: attachment.filename, path: targetPath })
          }
        }
        const body = (text.plain.join('\n\n').trim() || text.html.join('\n\n').trim() || message.snippet || '')
          .slice(0, 60_000)
        messages.push({
          account,
          id: message.id,
          threadId: message.threadId,
          receivedAt: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : '',
          from: header(message, 'From'),
          to: header(message, 'To'),
          subject: header(message, 'Subject'),
          messageId: header(message, 'Message-ID'),
          snippet: message.snippet || '',
          body,
          attachments,
          downloadedAttachments,
        })
      }
      accounts.push({ account, status: 'success', count: ids.length })
    } catch (error) {
      accounts.push({ account, status: 'failed', error: error instanceof Error ? error.message : String(error) })
    }
  }
  const output = { schemaVersion: 1, generatedAt: new Date().toISOString(), days, after, before, query, accounts, messages }
  writeFileSync(outputPath, JSON.stringify(output), 'utf8')
  console.log(JSON.stringify({ outputPath, days, accounts, messages: messages.length }))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
