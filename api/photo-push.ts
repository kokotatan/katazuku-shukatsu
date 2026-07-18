import { put } from '@vercel/blob'

export const config = { maxDuration: 10 }

function safeStorageKey(value: string): boolean {
  return /^[a-zA-Z0-9._/-]+$/.test(value) && !value.includes('..') && !value.startsWith('/')
}

export default async function handler(
  req: { method?: string; headers: Record<string, string | string[] | undefined>; body?: unknown },
  res: { status: (n: number) => { json: (b: unknown) => void } },
) {
  if (req.method !== 'PUT') {
    res.status(405).json({ error: 'PUT only' })
    return
  }
  const auth = String(req.headers.authorization || '')
  const secret = process.env.KATAZUKU_WRITE_SECRET
  if (!secret || auth !== `Bearer ${secret}`) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }
  const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as {
    storageKey?: string
    contentBase64?: string
    contentType?: string
  }
  if (!body?.storageKey || !safeStorageKey(body.storageKey) || !body.contentBase64) {
    res.status(400).json({ error: 'invalid payload' })
    return
  }
  const bytes = Buffer.from(body.contentBase64, 'base64')
  if (bytes.length > 2 * 1024 * 1024) {
    res.status(413).json({ error: 'photo too large' })
    return
  }
  const blob = await put(`private-photos/${body.storageKey}`, bytes, {
    access: 'private',
    contentType: body.contentType || 'image/jpeg',
    addRandomSuffix: false,
    allowOverwrite: true,
  } as Parameters<typeof put>[2])
  res.status(200).json({ ok: true, pathname: blob.pathname, bytes: bytes.length })
}
