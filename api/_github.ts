/**
 * Zenn連携リポ(ZENN_REPO)への読み書き共通部。GitHub Contents API を素のfetchで叩く。
 * 認証: ZENN_GITHUB_TOKEN(fine-grained PAT, contents:rw)。先頭_なのでFunction化されない。
 */
const API = 'https://api.github.com'

function repo(): string {
  const r = process.env.ZENN_REPO
  if (!r) throw new Error('ZENN_REPO 未設定')
  return r
}
function token(): string {
  const t = process.env.ZENN_GITHUB_TOKEN
  if (!t) throw new Error('ZENN_GITHUB_TOKEN 未設定')
  return t
}
export function branch(): string {
  return process.env.ZENN_BRANCH || 'main'
}

async function gh(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'katazuku-studio',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.headers as Record<string, string> | undefined),
    },
  })
}

export interface ArticleMeta {
  slug: string
  title: string
  emoji: string
  published: boolean
}

export function parseFrontmatter(md: string): { title: string; emoji: string; published: boolean } {
  const head = md.startsWith('---') ? md.slice(3, md.indexOf('\n---', 3) + 1) : ''
  const pick = (k: string) => {
    const m = head.match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : ''
  }
  return {
    title: pick('title'),
    emoji: pick('emoji'),
    published: /^published:\s*true\s*$/m.test(head),
  }
}

/** published: の行を指定値へ書き換える(無ければ何もしない) */
export function setPublished(md: string, value: boolean): string {
  return md.replace(/^published:\s*.*$/m, `published: ${value}`)
}

export async function listArticles(): Promise<ArticleMeta[]> {
  const r = await gh(`/repos/${repo()}/contents/articles?ref=${branch()}`)
  if (r.status === 404) return []
  if (!r.ok) throw new Error(`list ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const items = (await r.json()) as { name: string; type: string }[]
  const slugs = items.filter((i) => i.type === 'file' && i.name.endsWith('.md')).map((i) => i.name.replace(/\.md$/, ''))
  const metas: ArticleMeta[] = []
  for (const slug of slugs) {
    const a = await getArticle(slug)
    if (a) metas.push({ slug, ...parseFrontmatter(a.md) })
  }
  return metas
}

export async function getArticle(slug: string): Promise<{ md: string; sha: string } | null> {
  const r = await gh(`/repos/${repo()}/contents/articles/${slug}.md?ref=${branch()}`)
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`get ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const j = (await r.json()) as { content: string; sha: string; encoding: string }
  const md = Buffer.from(j.content, j.encoding as BufferEncoding).toString('utf8')
  return { md, sha: j.sha }
}

export async function putArticle(slug: string, md: string, message: string): Promise<{ commitUrl: string }> {
  const existing = await getArticle(slug)
  const r = await gh(`/repos/${repo()}/contents/articles/${slug}.md`, {
    method: 'PUT',
    body: JSON.stringify({
      message,
      content: Buffer.from(md, 'utf8').toString('base64'),
      branch: branch(),
      ...(existing ? { sha: existing.sha } : {}),
    }),
  })
  if (!r.ok) throw new Error(`put ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const j = (await r.json()) as { commit?: { html_url?: string } }
  return { commitUrl: j.commit?.html_url ?? '' }
}

export function zennUrl(slug: string): string | null {
  const u = process.env.ZENN_USERNAME
  return u ? `https://zenn.dev/${u}/articles/${slug}` : null
}
