/**
 * Web Push送信の受け口(spec16)。agentのPCからのPOSTのみ。
 * 認証: Authorization: Bearer <KATAZUKU_WRITE_SECRET>(api/push.tsと同じ)。
 * body: { title?, body?, url? }。保存済みの全購読へVAPIDで送り、失効した購読(404/410)は掃除する。
 * 通知本文はロック画面に出るため要約レベルに留める(呼び出し側の責務)。
 */
import { put } from '@vercel/blob'
import webpush from 'web-push'
import { loadSubscriptions } from './_push-store'

export const config = { maxDuration: 30 }

export default async function handler(req: { method?: string; headers: Record<string, string | string[] | undefined>; body?: unknown }, res: {
  status: (n: number) => { json: (b: unknown) => void }
  setHeader: (k: string, v: string) => void
}) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' })
    return
  }
  const auth = String(req.headers['authorization'] ?? '')
  const secret = process.env.KATAZUKU_WRITE_SECRET
  if (!secret || auth !== `Bearer ${secret}`) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }
  const publicKey = process.env.KATAZUKU_VAPID_PUBLIC_KEY
  const privateKey = process.env.KATAZUKU_VAPID_PRIVATE_KEY
  const subject = process.env.KATAZUKU_VAPID_SUBJECT
  if (!publicKey || !privateKey || !subject) {
    res.status(500).json({ error: 'VAPID env not configured' })
    return
  }
  webpush.setVapidDetails(subject, publicKey, privateKey)

  const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {}) as { title?: string; body?: string; url?: string }
  const payload = JSON.stringify({
    title: body.title || 'katazuku',
    body: body.body || '',
    url: body.url || '/insight/',
  })

  const subs = await loadSubscriptions()
  if (subs.length === 0) {
    res.status(200).json({ ok: true, sent: 0, removed: 0, failed: 0, note: 'no subscriptions' })
    return
  }

  let sent = 0
  const gone: string[] = []
  const failures: string[] = []
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        payload,
        { TTL: 12 * 60 * 60 },
      )
      sent++
    } catch (e) {
      const statusCode = (e as { statusCode?: number }).statusCode
      if (statusCode === 404 || statusCode === 410) gone.push(sub.endpoint)
      else failures.push(`${statusCode ?? 'ERR'}`)
    }
  }

  if (gone.length > 0) {
    const next = subs.filter((s) => !gone.includes(s.endpoint))
    await put('push-subscriptions.json', JSON.stringify(next), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
    } as Parameters<typeof put>[2])
  }
  res.status(200).json({ ok: true, sent, removed: gone.length, failed: failures.length, failures })
}
