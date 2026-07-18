/**
 * アプリ向けの読み取り口。合言葉(KATAZUKU_READ_SECRET)が合えばスナップショットを返す。
 * BlobはPrivateストア: head()のdownloadUrl(署名付き)経由で読む。SDK差異に備え複数の読み方を試す。
 */
export const config = { maxDuration: 10 }

export default async function handler(req: { method?: string; query?: Record<string, string | string[]>; url?: string }, res: {
  status: (n: number) => { json: (b: unknown) => void; send: (b: string) => void }
  setHeader: (k: string, v: string) => void
}) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', 'no-store')
  const key = String((req.query?.key as string) ?? new URL(req.url ?? '', 'http://x').searchParams.get('key') ?? '')
  const secret = process.env.KATAZUKU_READ_SECRET
  if (!secret || key !== secret) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }

  const blobMod = (await import('@vercel/blob')) as unknown as Record<string, unknown>
  const tried: string[] = []
  const attempt = async (label: string, fn: () => Promise<string | null>): Promise<string | null> => {
    try {
      const t = await fn()
      if (t !== null) return t
      tried.push(`${label}: null`)
    } catch (e) {
      tried.push(`${label}: ${e instanceof Error ? e.message.slice(0, 120) : String(e).slice(0, 120)}`)
    }
    return null
  }

  type HeadFn = (p: string) => Promise<{ url?: string; downloadUrl?: string } | null>
  type GetFn = (p: string, o?: unknown) => Promise<{ blob?: { text: () => Promise<string> } } | null>
  type ListFn = (o?: unknown) => Promise<{ blobs: { pathname: string; url?: string; downloadUrl?: string }[] }>

  let text: string | null = null

  if (text === null && typeof blobMod.get === 'function') {
    text = await attempt('get', async () => {
      const r = await (blobMod.get as GetFn)('snapshot.json', { access: 'private' })
      const b = r?.blob as unknown as {
        text?: () => Promise<string>
        stream?: () => ReadableStream
        body?: ReadableStream
        arrayBuffer?: () => Promise<ArrayBuffer>
        downloadUrl?: string
      } | null
      if (!b) return null
      if (b.downloadUrl) {
        // Privateストアのget()は署名付きdownloadUrl入りのメタデータを返す(実測 2026-07-18)
        const resp = await fetch(b.downloadUrl)
        if (!resp.ok) throw new Error(`downloadUrl fetch ${resp.status}`)
        return await resp.text()
      }
      if (typeof b.text === 'function') return await b.text()
      if (typeof b.stream === 'function') return await new Response(b.stream()).text()
      if (b.body) return await new Response(b.body).text()
      if (typeof b.arrayBuffer === 'function') return new TextDecoder().decode(await b.arrayBuffer())
      throw new Error('unknown blob shape: ' + Object.keys(b as object).join(','))
    })
  }
  if (text === null && typeof blobMod.head === 'function') {
    text = await attempt('head', async () => {
      const h = await (blobMod.head as HeadFn)('snapshot.json')
      const u = h?.downloadUrl ?? h?.url
      if (!u) return null
      const r = await fetch(u)
      if (!r.ok) throw new Error(`fetch ${r.status}`)
      return await r.text()
    })
  }
  if (text === null && typeof blobMod.list === 'function') {
    text = await attempt('list', async () => {
      const l = await (blobMod.list as ListFn)({ prefix: 'snapshot', limit: 5 })
      const b = l.blobs.find((x) => x.pathname.startsWith('snapshot'))
      const u = b?.downloadUrl ?? b?.url
      if (!u) return null
      const r = await fetch(u)
      if (!r.ok) throw new Error(`fetch ${r.status}`)
      return await r.text()
    })
  }

  if (text === null) {
    res.status(404).json({ error: 'snapshot not found', tried })
    return
  }
  res.setHeader('Content-Type', 'application/json')
  res.status(200).send(text)
}
