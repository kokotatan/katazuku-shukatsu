import { STAGES, type Company, type Stage } from '../types'

const STAGE_KEYS = new Set<string>(STAGES.map((s) => s.key))

/** 「株式会社」等の表記ゆれを吸収して同一企業か判定する */
function normalize(name: string): string {
  return name
    .normalize('NFKC') // 全角カッコ・全角英数を半角に揃える
    .toLowerCase()
    .replace(/株式会社|合同会社|有限会社|\(株\)/g, '')
    .replace(/[()\s　]/g, '')
}

export function sameCompany(a: string, b: string): boolean {
  const na = normalize(a)
  const nb = normalize(b)
  // 短い名前(Go等)は部分一致だと誤マージするので完全一致のみ
  if (na.length < 3 || nb.length < 3) return na === nb
  return na.includes(nb) || nb.includes(na)
}

export interface ImportResult {
  companies: Company[]
  added: number
  enriched: number
}

/**
 * インポートデータを既存のボードへマージする。
 * 既存企業はユーザーが育てたカードなので stage / nextAction / nextDate は触らず、
 * 空いている項目(職種・業界・志望度・マイページURL・メモ)だけ補完する。
 */
export function mergeImport(current: Company[], data: unknown): ImportResult {
  if (!Array.isArray(data)) throw new Error('配列のJSONではありません')
  const companies = current.map((c) => ({ ...c }))
  let added = 0
  let enriched = 0
  const now = new Date().toISOString()

  for (const item of data) {
    if (typeof item !== 'object' || item === null) continue
    const d = item as Record<string, unknown>
    const name = String(d.name ?? '').trim()
    if (!name) continue
    const str = (key: string) => (typeof d[key] === 'string' ? (d[key] as string).trim() : '')
    const stage: Stage = STAGE_KEYS.has(str('stage')) ? (str('stage') as Stage) : 'scouted'

    const existing = companies.find((c) => sameCompany(c.name, name))
    if (existing) {
      let changed = false
      const fill = (key: 'role' | 'industry' | 'priority' | 'mypageUrl') => {
        const v = str(key)
        if (v && !existing[key]) {
          existing[key] = v
          changed = true
        }
      }
      fill('role')
      fill('industry')
      fill('priority')
      fill('mypageUrl')
      const memo = str('memo')
      if (memo && !existing.memo.includes(memo)) {
        existing.memo = existing.memo ? `${existing.memo}\n${memo}` : memo
        changed = true
      }
      if (changed) {
        existing.updatedAt = now
        enriched++
      }
    } else {
      companies.push({
        id: `c-${Date.now()}-${added}`,
        name,
        role: str('role'),
        stage,
        nextAction: str('nextAction'),
        nextDate: str('nextDate') || null,
        memo: str('memo'),
        industry: str('industry') || undefined,
        priority: str('priority') || undefined,
        mypageUrl: str('mypageUrl') || undefined,
        updatedAt: now,
      })
      added++
    }
  }

  return { companies, added, enriched }
}
