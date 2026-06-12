import type { Category, Email } from '../types'

// Pipeline (pipeline/src/types.ts) と同じ形。localStorage 経由で連携するため
// 両アプリは同一オリジン(katazuku.kotalab.com)配下に置く前提
type Stage = 'scouted' | 'entried' | 'task' | 'interview' | 'intern' | 'offer' | 'closed'

interface Company {
  id: string
  name: string
  role: string
  stage: Stage
  nextAction: string
  nextDate: string | null
  memo: string
  updatedAt: string
}

const STORAGE_KEY = 'katazuku-pipeline/companies'

/** メールのカテゴリから初期ステージを推定する */
const STAGE_FOR: Record<Category, Stage> = {
  interview: 'interview',
  task: 'task',
  result: 'entried',
  event: 'scouted',
  other: 'scouted',
}

// インターン合格・内定・終了は手動管理の結果なので自動連携では動かさない
const UPGRADE_ORDER: Stage[] = ['scouted', 'entried', 'task', 'interview']

/** 「株式会社」等の表記ゆれを吸収して同一企業か判定する */
function normalize(name: string): string {
  return name
    .normalize('NFKC') // 全角カッコ・全角英数を半角に揃える
    .toLowerCase()
    .replace(/株式会社|合同会社|有限会社|\(株\)/g, '')
    .replace(/[()\s　]/g, '')
}

function sameCompany(a: string, b: string): boolean {
  const na = normalize(a)
  const nb = normalize(b)
  // 短い名前(Go等)は部分一致だと誤マージするので完全一致のみ
  if (na.length < 3 || nb.length < 3) return na === nb
  return na.includes(nb) || nb.includes(na)
}

function load(): Company[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw !== null) return JSON.parse(raw) as Company[]
  } catch {
    // 壊れたデータは空扱い(Pipeline側の初期データはseededフラグで別途投入される)
  }
  return []
}

export interface AddResult {
  /** false なら既存企業の更新 */
  created: boolean
  name: string
}

/**
 * メールから選考ボード(Pipeline)に企業を追加・更新する。
 * 既存企業なら次のアクション・期限を上書きし、ステージは前進方向にのみ動かす。
 */
export function addEmailToPipeline(email: Email): AddResult {
  const companies = load()
  const nextDate = email.deadline ? email.deadline.slice(0, 10) : null
  const nextAction = email.actionHint ?? `メール「${email.subject}」に対応`
  const stage = STAGE_FOR[email.category]
  const now = new Date().toISOString()

  const existing = companies.find((c) => sameCompany(c.name, email.company))
  if (existing) {
    existing.nextAction = nextAction
    existing.nextDate = nextDate ?? existing.nextDate
    existing.updatedAt = now
    const cur = UPGRADE_ORDER.indexOf(existing.stage)
    const next = UPGRADE_ORDER.indexOf(stage)
    if (cur !== -1 && next > cur) existing.stage = stage
  } else {
    companies.push({
      id: `c-${Date.now()}`,
      name: email.company,
      role: '',
      stage,
      nextAction,
      nextDate,
      memo: `Inboxから追加: ${email.subject}`,
      updatedAt: now,
    })
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(companies))
  return { created: !existing, name: existing?.name ?? email.company }
}
