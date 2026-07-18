import type { RawEmail } from '../types'

/**
 * Google Identity Services を使ったクライアントサイドのみの Gmail 読み取り。
 * バックエンド不要。ユーザー自身の OAuth クライアントID を設定画面で入力して使う。
 */

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string
            scope: string
            callback: (resp: { access_token?: string; error?: string }) => void
          }): { requestAccessToken(): void }
        }
      }
    }
  }
}

const GSI_SRC = 'https://accounts.google.com/gsi/client'
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
const API = 'https://gmail.googleapis.com/gmail/v1/users/me'

let gsiLoaded: Promise<void> | null = null

function loadGsi(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve()
  if (!gsiLoaded) {
    gsiLoaded = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = GSI_SRC
      s.async = true
      s.onload = () => resolve()
      s.onerror = () => reject(new Error('Google認証スクリプトの読み込みに失敗しました'))
      document.head.appendChild(s)
    })
  }
  return gsiLoaded
}

export async function requestAccessToken(clientId: string): Promise<string> {
  await loadGsi()
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.access_token) resolve(resp.access_token)
        else reject(new Error(resp.error ?? 'アクセスが許可されませんでした'))
      },
    })
    client.requestAccessToken()
  })
}

interface GmailHeader {
  name: string
  value: string
}

interface GmailPart {
  mimeType: string
  body?: { data?: string }
  parts?: GmailPart[]
}

interface GmailMessage {
  id: string
  internalDate: string
  payload: GmailPart & { headers: GmailHeader[] }
}

function b64urlDecode(data: string): string {
  const bin = atob(data.replace(/-/g, '+').replace(/_/g, '/'))
  return new TextDecoder('utf-8').decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

function findBody(part: GmailPart, mime: string): string | null {
  if (part.mimeType === mime && part.body?.data) return b64urlDecode(part.body.data)
  for (const child of part.parts ?? []) {
    const found = findBody(child, mime)
    if (found) return found
  }
  return null
}

function stripHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return doc.body.textContent ?? ''
}

function parseFrom(value: string): { name: string; address: string } {
  const m = value.match(/^\s*"?(.*?)"?\s*<(.+)>\s*$/)
  if (m) return { name: m[1] || m[2], address: m[2] }
  return { name: value, address: value }
}

/** 直近のメールを取得して RawEmail に変換する */
export async function fetchRecentEmails(
  token: string,
  options: { maxResults?: number; days?: number } = {},
): Promise<RawEmail[]> {
  const { maxResults = 50, days = 14 } = options
  const headers = { Authorization: `Bearer ${token}` }
  const q = encodeURIComponent(`newer_than:${days}d -in:spam -in:trash category:primary`)

  const listRes = await fetch(`${API}/messages?maxResults=${maxResults}&q=${q}`, { headers })
  if (!listRes.ok) throw new Error(`Gmail API エラー (${listRes.status})`)
  const list: { messages?: { id: string }[] } = await listRes.json()
  if (!list.messages?.length) return []

  const emails = await Promise.all(
    list.messages.map(async ({ id }): Promise<RawEmail | null> => {
      const res = await fetch(`${API}/messages/${id}?format=full`, { headers })
      if (!res.ok) return null
      const msg: GmailMessage = await res.json()
      const header = (name: string) =>
        msg.payload.headers.find((h) => h.name.toLowerCase() === name)?.value ?? ''
      const { name, address } = parseFrom(header('from'))
      const plain = findBody(msg.payload, 'text/plain')
      const html = plain ? null : findBody(msg.payload, 'text/html')
      return {
        id: `gmail-${msg.id}`,
        from: name,
        fromAddress: address,
        subject: header('subject'),
        body: plain ?? (html ? stripHtml(html) : ''),
        receivedAt: new Date(Number(msg.internalDate)).toISOString(),
        source: 'gmail',
      }
    }),
  )
  return emails.filter((e): e is RawEmail => e !== null)
}
