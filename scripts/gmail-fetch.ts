/**
 * Gmail を LLM / MCP なしで読み取り、日次同期の抽出用ローカルJSONへ保存する。
 * ラベル変更・既読化・下書き・送信は一切しない(読み取り専用の決定的な入口)。
 *
 *   npx tsx scripts/gmail-fetch.ts <out.json> [--days N] [--after YYYY-MM-DD --before YYYY-MM-DD] [--query "..."]
 *
 * 対象アカウントと検索語は katazuku.config.json(google.accounts / mail.searchTerms)。
 * 1通だけ本文が取れなくてもアカウント全体を捨てず、失敗した通はIDと理由を残して status=partial にする。
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getGoogleAccessToken } from '../src/google-auth.js'
import { googleRead } from '../src/google-read.js'
import { loadConfig, type KatazukuConfig } from '../src/katazuku-config.js'

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

export interface FetchedMail {
  schemaVersion: 1
  generatedAt: string
  query: string
  accounts: { account: string; status: 'success' | 'partial' | 'failed'; count?: number; error?: string }[]
  messages: {
    account: string
    id: string
    threadId: string
    receivedAt: string
    from: string
    to: string
    subject: string
    snippet: string
    body: string
    attachments: { filename: string; mimeType: string; size: number }[]
  }[]
  failedMessages: { account: string; id: string; error: string }[]
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
}

export function stripHtml(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/div>|<\/tr>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
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

function collectAttachments(part: GmailPart | undefined): { filename: string; mimeType: string; size: number }[] {
  if (!part) return []
  const out = part.filename
    ? [{ filename: part.filename, mimeType: part.mimeType || 'application/octet-stream', size: part.body?.size || 0 }]
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
    const response = await googleRead(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`, token)
    if (!response.ok) throw new Error(`Gmail検索失敗(HTTP ${response.status})`)
    const result = await response.json() as { messages?: { id: string }[]; nextPageToken?: string }
    ids.push(...(result.messages || []).map((item) => item.id))
    pageToken = result.nextPageToken || ''
    if (pageToken && ids.length >= 10_000) throw new Error('対象メールが多すぎます。期間を分割してください')
  } while (pageToken)
  return [...new Set(ids)]
}

async function getMessage(token: string, id: string): Promise<GmailMessage> {
  const response = await googleRead(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`, token)
  if (!response.ok) throw new Error(`本文取得失敗(HTTP ${response.status})`)
  return response.json() as Promise<GmailMessage>
}

export function buildQuery(config: KatazukuConfig, options: { days?: number; after?: string; before?: string; query?: string }): string {
  if (options.query) return options.query
  const dateQuery = options.after
    ? `after:${options.after.replace(/-/g, '/')}${options.before ? ` before:${options.before.replace(/-/g, '/')}` : ''}`
    : `newer_than:${options.days ?? 1}d`
  return `${dateQuery} {${config.mail.searchTerms.join(' ')}}`
}

export async function fetchGmail(
  config: KatazukuConfig,
  options: { days?: number; after?: string; before?: string; query?: string } = {},
): Promise<FetchedMail> {
  if (!config.google.accounts.length) throw new Error('google.accounts が未設定です(katazuku.config.json)')
  const query = buildQuery(config, options)
  const output: FetchedMail = { schemaVersion: 1, generatedAt: new Date().toISOString(), query, accounts: [], messages: [], failedMessages: [] }
  for (const { email: account } of config.google.accounts) {
    try {
      const token = await getGoogleAccessToken(account, config.google.credentialsDir)
      const ids = await listMessageIds(token, query)
      const failures: { id: string; error: string }[] = []
      // 読み取りだけを最大5件ずつ先行させる。一時障害(429/5xx/rateLimitExceeded)の再試行は googleRead が行う。
      for (let offset = 0; offset < ids.length; offset += 5) {
        const batch = ids.slice(offset, offset + 5)
        const results = await Promise.allSettled(batch.map((id) => getMessage(token, id)))
        for (const [index, result] of results.entries()) {
          if (result.status === 'rejected') {
            failures.push({ id: batch[index], error: result.reason instanceof Error ? result.reason.message : String(result.reason) })
            continue
          }
          const message = result.value
          const text = collectText(message.payload)
          const body = (text.plain.join('\n\n').trim() || text.html.join('\n\n').trim() || message.snippet || '').slice(0, 60_000)
          output.messages.push({
            account,
            id: message.id,
            threadId: message.threadId,
            receivedAt: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : '',
            from: header(message, 'From'),
            to: header(message, 'To'),
            subject: header(message, 'Subject'),
            snippet: message.snippet || '',
            body,
            attachments: collectAttachments(message.payload),
          })
        }
      }
      output.failedMessages.push(...failures.map((failure) => ({ account, ...failure })))
      if (!failures.length) output.accounts.push({ account, status: 'success', count: ids.length })
      else if (failures.length === ids.length) output.accounts.push({ account, status: 'failed', count: ids.length, error: `全${ids.length}通の本文取得に失敗: ${failures[0].error}` })
      else output.accounts.push({ account, status: 'partial', count: ids.length - failures.length })
    } catch (error) {
      output.accounts.push({ account, status: 'failed', error: error instanceof Error ? error.message : String(error) })
    }
  }
  return output
}

const invokedDirectly = process.argv[1] != null && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
if (invokedDirectly) {
  const args = process.argv.slice(2)
  const option = (name: string) => {
    const index = args.indexOf(name)
    return index >= 0 ? args[index + 1] : undefined
  }
  const out = args[0] && !args[0].startsWith('--') ? resolve(args[0]) : undefined
  if (!out) {
    console.error('使い方: npx tsx scripts/gmail-fetch.ts <out.json> [--days N] [--after YYYY-MM-DD] [--before YYYY-MM-DD] [--query "..."]')
    process.exit(1)
  }
  const days = Number(option('--days') ?? 1)
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error('--days は1〜30です')
  const result = await fetchGmail(loadConfig(), { days, after: option('--after'), before: option('--before'), query: option('--query') })
  writeFileSync(out, JSON.stringify(result), 'utf8')
  console.log(JSON.stringify({ out, accounts: result.accounts, messages: result.messages.length, failedMessages: result.failedMessages.length }))
}
