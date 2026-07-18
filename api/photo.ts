export const config = { maxDuration: 10 }

function safeStorageKey(value: string): boolean {
  return /^[a-zA-Z0-9._/-]+$/.test(value) && !value.includes('..') && !value.startsWith('/')
}

export default async function handler(
  req: { query?: Record<string, string | string[]>; url?: string },
  res: {
    status: (n: number) => { json: (b: unknown) => void; send: (b: unknown) => void }
    setHeader: (k: string, v: string) => void
  },
) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', 'private, max-age=300')
  const url = new URL(req.url || '', 'http://x')
  const key = String((req.query?.key as string) || url.searchParams.get('key') || '')
  const id = String((req.query?.id as string) || url.searchParams.get('id') || '')
  const secret = process.env.KATAZUKU_READ_SECRET
  if (!secret || key !== secret) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }
  if (!safeStorageKey(id)) {
    res.status(400).json({ error: 'invalid id' })
    return
  }
  const blobMod = await import('@vercel/blob')
  const result = await blobMod.get(`private-photos/${id}`, { access: 'private' } as Parameters<typeof blobMod.get>[1])
  if (!result?.stream) {
    res.status(404).json({ error: 'not found' })
    return
  }
  const bytes = Buffer.from(await new Response(result.stream).arrayBuffer())
  res.setHeader('Content-Type', result.blob.contentType || 'application/octet-stream')
  res.status(200).send(bytes)
}
