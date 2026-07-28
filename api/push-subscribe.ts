/**
 * Web Push購読の受け口(spec16)。合言葉(KATAZUKU_READ_SECRET)が合えば購読情報を保存する。
 * 保存先: Vercel Blob(Privateストア) push-subscriptions.json(endpointをキーに上書きマージ)。
 * 購読情報は個人データ扱い: 署名なしURLで公開しない・レスポンスに中身を返さない。
 */
import { put } from '@vercel/blob'
import { loadSubscriptions, type PushSubscriptionRecord } from './_push-store'

export const config = { maxDuration: 10 }

export default async function handler(req: { method?: string; query?: Record<string, string | string[]>; url?: string; body?: unknown }, res: {
  status: (n: number) => { json: (b: unknown) => void }
  setHeader: (k: string, v: string) => void
}) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' })
    return
  }
  const key = String((req.query?.key as string) ?? new URL(req.url ?? '', 'http://x').searchParams.get('key') ?? '')
  const secret = process.env.KATAZUKU_READ_SECRET
  if (!secret || key !== secret) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }

  const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as PushSubscriptionRecord | undefined
  if (!body?.endpoint || !body.endpoint.startsWith('https://') || !body.keys?.p256dh || !body.keys?.auth) {
    res.status(400).json({ error: 'invalid subscription' })
    return
  }

  const subs = await loadSubscriptions()
  const next = subs.filter((s) => s.endpoint !== body.endpoint)
  next.push({ endpoint: body.endpoint, expirationTime: body.expirationTime ?? null, keys: { p256dh: body.keys.p256dh, auth: body.keys.auth }, savedAt: new Date().toISOString() })
  await put('push-subscriptions.json', JSON.stringify(next), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  } as Parameters<typeof put>[2])
  res.status(200).json({ ok: true, count: next.length })
}
