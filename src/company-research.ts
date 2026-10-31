import type { DatabaseSync } from 'node:sqlite'
import { resolveCompany } from './db.js'
import { upsertCompanyDossier } from './platform.js'

export interface CompanyResearchSource {
  title: string
  url: string
}

export interface CompanyResearchInput {
  company: string
  summary: string
  facts?: Record<string, unknown>
  sources: CompanyResearchSource[]
  researchedAt: string
  sourceRef: string
}

export interface CompanyResearchResult {
  companyId: number
  changed: boolean
  reason: 'recorded' | 'older_than_current'
}

/**
 * 既存の企業へ、根拠のある企業研究だけを反映する。
 *
 * MCPのような遠隔入口から企業マスタを新規作成すると、表記揺れや同名法人を誤って
 * 正本化しやすい。そのため会社は既存の正式名・確認済みaliasで1社に解決できる場合だけ
 * 許可する。古い調査が新しい調査を巻き戻すこともない。
 */
export function applyCompanyResearch(db: DatabaseSync, input: CompanyResearchInput): CompanyResearchResult {
  const company = input.company?.trim()
  const summary = input.summary?.trim()
  const sourceRef = input.sourceRef?.trim()
  if (!company || !summary || !sourceRef) throw new Error('company、summary、sourceRefは必須です')
  if (!Array.isArray(input.sources) || input.sources.length === 0) throw new Error('sourcesは1件以上必要です')
  if (!input.researchedAt || Number.isNaN(Date.parse(input.researchedAt))) throw new Error('researchedAtが不正です')
  for (const source of input.sources) {
    if (!source?.title?.trim()) throw new Error('source.titleは必須です')
    let url: URL
    try { url = new URL(source.url) } catch { throw new Error(`source.urlが不正です: ${source.url}`) }
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error(`source.urlはhttp(s)だけ利用できます: ${source.url}`)
  }

  const resolution = resolveCompany(db, company)
  if (resolution.kind === 'suspicious') {
    throw new Error(`企業名が一意に確定しません: ${company}（候補: ${resolution.suggestName}）`)
  }
  if (resolution.kind === 'new') throw new Error(`既存の企業が見つかりません: ${company}`)

  const current = db.prepare('SELECT researched_at FROM company_dossier WHERE company_id = ?')
    .get(resolution.companyId) as { researched_at: string } | undefined
  if (current && Date.parse(current.researched_at) > Date.parse(input.researchedAt)) {
    return { companyId: resolution.companyId, changed: false, reason: 'older_than_current' }
  }

  upsertCompanyDossier(db, resolution.companyId, {
    summary,
    facts: input.facts ?? {},
    sources: input.sources.map((source) => ({ title: source.title.trim(), url: source.url })),
    researchedAt: input.researchedAt,
    sourceRef,
  })
  return { companyId: resolution.companyId, changed: true, reason: 'recorded' }
}
