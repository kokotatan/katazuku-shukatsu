/**
 * エディタ(/studio/)向けの読み取り口。合言葉(KATAZUKU_STUDIO_SECRET)が合えば、
 * Zenn連携リポの記事一覧、または ?slug= の本文を返す。
 */
import { listArticles, getArticle, parseFrontmatter, branch } from './_github'

function rawBase(): string {
  const r = process.env.ZENN_REPO
  return r ? `https://raw.githubusercontent.com/${r}/${branch()}/` : ''
}

export const config = { maxDuration: 15 }

export default async function handler(req: { method?: string; query?: Record<string, string | string[]>; url?: string }, res: {
  status: (n: number) => { json: (b: unknown) => void }
  setHeader: (k: string, v: string) => void
}) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method && req.method !== 'GET') {
    res.status(405).json({ error: 'GET only' })
    return
  }
  const sp = new URL(req.url ?? '', 'http://x').searchParams
  const key = String((req.query?.key as string) ?? sp.get('key') ?? '')
  const secret = process.env.KATAZUKU_STUDIO_SECRET
  if (!secret || key !== secret) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }
  const slug = String((req.query?.slug as string) ?? sp.get('slug') ?? '')
  try {
    if (slug) {
      const a = await getArticle(slug)
      if (!a) {
        res.status(404).json({ error: 'not found' })
        return
      }
      res.status(200).json({ slug, md: a.md, meta: parseFrontmatter(a.md), rawBase: rawBase() })
      return
    }
    const articles = await listArticles()
    res.status(200).json({ articles, rawBase: rawBase() })
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
  }
}
