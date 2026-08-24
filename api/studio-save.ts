/**
 * エディタ(/studio/)からの保存/公開口。
 * 認証: Authorization: Bearer <KATAZUKU_STUDIO_SECRET>。
 * body: { slug, md, publish? }。publish が真偽で来たら frontmatter の published をそれに合わせる。
 * Zenn連携リポの articles/<slug>.md へ commit する(=Zennが自動反映)。
 */
import { getArticle, putArticle, setPublished, parseFrontmatter, zennUrl } from './_github'

export const config = { maxDuration: 20 }

export default async function handler(req: { method?: string; headers: Record<string, string | string[] | undefined>; body?: unknown }, res: {
  status: (n: number) => { json: (b: unknown) => void }
  setHeader: (k: string, v: string) => void
}) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST' && req.method !== 'PUT') {
    res.status(405).json({ error: 'POST/PUT only' })
    return
  }
  const auth = String(req.headers['authorization'] ?? '')
  const secret = process.env.KATAZUKU_STUDIO_SECRET
  if (!secret || auth !== `Bearer ${secret}`) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }

  let body: { slug?: string; md?: string; publish?: boolean }
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body as typeof body) ?? {}
  } catch {
    res.status(400).json({ error: 'invalid JSON' })
    return
  }

  const slug = String(body.slug ?? '')
  let md = String(body.md ?? '')
  if (!/^[a-z0-9][a-z0-9_-]{0,49}$/.test(slug)) {
    res.status(400).json({ error: 'slug は英小文字/数字/-/_ の1〜50文字' })
    return
  }
  if (!md.startsWith('---')) {
    res.status(400).json({ error: 'frontmatter(---) が必要です' })
    return
  }

  if (typeof body.publish === 'boolean') md = setPublished(md, body.publish)
  const meta = parseFrontmatter(md)

  try {
    // 既存と同一内容なら無駄なcommitを避ける
    const existing = await getArticle(slug)
    if (existing && existing.md === md) {
      res.status(200).json({ ok: true, unchanged: true, published: meta.published, zennUrl: meta.published ? zennUrl(slug) : null })
      return
    }
    const action = meta.published ? '公開' : '下書き保存'
    const { commitUrl } = await putArticle(slug, md, `studio: ${action} ${slug}`)
    res.status(200).json({
      ok: true,
      published: meta.published,
      zennUrl: meta.published ? zennUrl(slug) : null,
      commitUrl,
    })
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
  }
}
