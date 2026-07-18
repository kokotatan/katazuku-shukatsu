/**
 * アプリ向けの読み取り口。合言葉(KATAZUKU_READ_SECRET)が合えばスナップショットを返す。
 * サインイン不要 — 初回に合言葉を1回入れるだけ(アプリ側がlocalStorageに記憶)。
 * BlobはPrivateストアなので、SDK経由でのみ読める(URL直アクセス不可)。
 */
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

  // SDKのバージョン差(get / head+downloadUrl)に両対応で読む
  const blobMod = (await import('@vercel/blob')) as unknown as {
    get?: (p: string) => Promise<{ blob: { text: () => Promise<string> } } | null>
    head?: (p: string) => Promise<{ url?: string; downloadUrl?: string } | null>
  }
  let text: string | null = null
  try {
    if (blobMod.get) {
      const r = await blobMod.get('snapshot.json')
      if (r?.blob) text = await r.blob.text()
    }
    if (text === null && blobMod.head) {
      const h = await blobMod.head('snapshot.json')
      const u = h?.downloadUrl ?? h?.url
      if (u) text = await (await fetch(u)).text()
    }
  } catch {
    text = null
  }
  if (text === null) {
    res.status(404).json({ error: 'snapshot not found (まだ一度もプッシュされていません)' })
    return
  }
  res.setHeader('Content-Type', 'application/json')
  res.status(200).send(text)
}
