/**
 * スナップショットの受け口(agentのPCからのPUTのみ)。
 * 認証: Authorization: Bearer <KATAZUKU_WRITE_SECRET> (Vercel環境変数)。
 * 保存: Vercel Blob の snapshot.json (上書き)。
 */
import { put } from '@vercel/blob'

export const config = { maxDuration: 10 }

export default async function handler(req: { method?: string; headers: Record<string, string | string[] | undefined>; body?: unknown }, res: {
  status: (n: number) => { json: (b: unknown) => void; end: () => void }
  setHeader: (k: string, v: string) => void
}) {
  if (req.method !== 'PUT') {
    res.status(405).json({ error: 'PUT only' })
    return
  }
  const auth = String(req.headers['authorization'] ?? '')
  const secret = process.env.KATAZUKU_WRITE_SECRET
  if (!secret || auth !== `Bearer ${secret}`) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }
  const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {})
  const blob = await put('snapshot.json', body, {
    access: 'public', // URLは推測不能ハッシュ付きだが、参照は必ず /api/data (合言葉つき) 経由にする
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  })
  res.status(200).json({ ok: true, url: blob.url, bytes: body.length })
}
