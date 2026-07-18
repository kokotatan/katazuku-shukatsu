/**
 * アプリ向けの読み取り口。合言葉(KATAZUKU_READ_SECRET)が合えばスナップショットを返す。
 * サインイン不要 — 初回に合言葉を1回入れるだけ(アプリ側がlocalStorageに記憶)。
 */
import { list } from '@vercel/blob'

export const config = { maxDuration: 10 }

export default async function handler(req: { method?: string; query?: Record<string, string | string[]>; url?: string }, res: {
  status: (n: number) => { json: (b: unknown) => void; send: (b: string) => void }
  setHeader: (k: string, v: string) => void
}) {
  res.setHeader('Access-Control-Allow-Origin', '*') // 開発サーバー(localhost)からも読めるように
  res.setHeader('Cache-Control', 'no-store')
  const key = String((req.query?.key as string) ?? new URL(req.url ?? '', 'http://x').searchParams.get('key') ?? '')
  const secret = process.env.KATAZUKU_READ_SECRET
  if (!secret || key !== secret) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }
  const blobs = await list({ prefix: 'snapshot.json', limit: 1 })
  const target = blobs.blobs[0]
  if (!target) {
    res.status(404).json({ error: 'snapshot not found (まだ一度もプッシュされていません)' })
    return
  }
  const data = await fetch(target.url)
  res.status(200).send(await data.text())
}
