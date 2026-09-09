import { Buffer } from 'node:buffer'

const API = 'https://api.github.com'

export interface ArticleMeta {
  slug: string
  title: string
  emoji: string
  published: boolean
}

function branch(env: Env): string {
  return optionalEnv(env, 'ZENN_BRANCH') || 'main'
}

function rawBase(env: Env): string {
  const repo = optionalEnv(env, 'ZENN_REPO')
  return repo
    ? `https://raw.githubusercontent.com/${repo}/${branch(env)}/`
    : ''
}

function optionalEnv(env: Env, name: string): string {
  const value = Reflect.get(env, name)
  return typeof value === 'string' ? value : ''
}

async function gh(env: Env, path: string, init?: RequestInit): Promise<Response> {
  return await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${optionalEnv(env, 'ZENN_GITHUB_TOKEN')}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'katazuku-studio',
      'X-GitHub-Api-Version': '2022-11-28',
      ...init?.headers,
    },
  })
}

export function parseFrontmatter(md: string): { title: string; emoji: string; published: boolean } {
  const end = md.indexOf('\n---', 3)
  const head = md.startsWith('---') && end >= 0 ? md.slice(3, end + 1) : ''
  const pick = (key: string): string => {
    const match = head.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'))
    return match?.[1] ? match[1].trim().replace(/^["']|["']$/g, '') : ''
  }
  return {
    title: pick('title'),
    emoji: pick('emoji'),
    published: /^published:\s*true\s*$/m.test(head),
  }
}

export function setPublished(md: string, value: boolean): string {
  return md.replace(/^published:\s*.*$/m, `published: ${value}`)
}

export async function getArticle(env: Env, slug: string): Promise<{ md: string; sha: string } | null> {
  const response = await gh(env, `/repos/${optionalEnv(env, 'ZENN_REPO')}/contents/articles/${slug}.md?ref=${branch(env)}`)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`GitHub get failed: ${response.status}`)
  const body: unknown = await response.json()
  if (!isArticleBody(body)) throw new Error('GitHub get returned an invalid body')
  return {
    md: Buffer.from(body.content, body.encoding as BufferEncoding).toString('utf8'),
    sha: body.sha,
  }
}

export async function listArticles(env: Env): Promise<ArticleMeta[]> {
  const response = await gh(env, `/repos/${optionalEnv(env, 'ZENN_REPO')}/contents/articles?ref=${branch(env)}`)
  if (response.status === 404) return []
  if (!response.ok) throw new Error(`GitHub list failed: ${response.status}`)
  const body: unknown = await response.json()
  if (!Array.isArray(body)) throw new Error('GitHub list returned an invalid body')
  const slugs = body
    .filter(isContentItem)
    .filter((item) => item.type === 'file' && item.name.endsWith('.md'))
    .map((item) => item.name.replace(/\.md$/, ''))
  const articles = await Promise.all(slugs.map(async (slug) => {
    const article = await getArticle(env, slug)
    return article ? { slug, ...parseFrontmatter(article.md) } : null
  }))
  return articles.filter((article): article is ArticleMeta => article !== null)
}

export async function putArticle(
  env: Env,
  slug: string,
  md: string,
  message: string,
): Promise<{ commitUrl: string }> {
  const existing = await getArticle(env, slug)
  const response = await gh(env, `/repos/${optionalEnv(env, 'ZENN_REPO')}/contents/articles/${slug}.md`, {
    method: 'PUT',
    body: JSON.stringify({
      message,
      content: Buffer.from(md, 'utf8').toString('base64'),
      branch: branch(env),
      ...(existing ? { sha: existing.sha } : {}),
    }),
  })
  if (!response.ok) throw new Error(`GitHub put failed: ${response.status}`)
  const body: unknown = await response.json()
  const commitUrl = isCommitBody(body) ? body.commit?.html_url ?? '' : ''
  return { commitUrl }
}

export function studioLinks(env: Env, slug?: string): { rawBase: string; zennUrl: string | null } {
  return {
    rawBase: rawBase(env),
    zennUrl: slug && optionalEnv(env, 'ZENN_USERNAME')
      ? `https://zenn.dev/${optionalEnv(env, 'ZENN_USERNAME')}/articles/${slug}`
      : null,
  }
}

function isContentItem(value: unknown): value is { name: string; type: string } {
  return typeof value === 'object' && value !== null
    && typeof Reflect.get(value, 'name') === 'string'
    && typeof Reflect.get(value, 'type') === 'string'
}

function isArticleBody(value: unknown): value is { content: string; sha: string; encoding: string } {
  return typeof value === 'object' && value !== null
    && typeof Reflect.get(value, 'content') === 'string'
    && typeof Reflect.get(value, 'sha') === 'string'
    && typeof Reflect.get(value, 'encoding') === 'string'
}

function isCommitBody(value: unknown): value is { commit?: { html_url?: string } } {
  return typeof value === 'object' && value !== null
}
