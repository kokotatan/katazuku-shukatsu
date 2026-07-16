import type { InboxEmail, PipelineCompany } from '../types'

/**
 * katazuku の「効果」試算。
 *
 * 数字は2種類ある:
 *  - 実数(事実):仕分けたメール数・弾いた宣伝数・拾った締切数など。localStorage の実データを数えるだけ。
 *  - 推計:手作業でやっていたら掛かった時間。実数 × 「1件あたりの手作業秒」で出す。
 *
 * 手作業秒はいまは推定値。実際に手で仕分け/転記して測ったら、
 * MANUAL_SEC / AUTO_SEC を実測値に差し替えるだけで全体が実測ベースに昇格する。
 */

/** 手作業でやった場合の1件あたり所要秒(推定・保守的に設定) */
export const MANUAL_SEC = { sort: 20, deadline: 40, action: 30 } as const
/** katazuku 導入後に残る手作業(目視確認のみ)の1件あたり秒 */
export const AUTO_SEC = { sort: 2, deadline: 5, action: 5 } as const

export type DomainKey = 'sort' | 'deadline' | 'action'

const DOMAIN_LABEL: Record<DomainKey, string> = {
  sort: 'メールの仕分け',
  deadline: '締切の書き出し',
  action: 'やることの洗い出し',
}

export interface OutcomeDomain {
  key: DomainKey
  label: string
  /** 対象件数(実数) */
  count: number
  /** 手作業なら掛かる総秒(推計) */
  manualSec: number
  /** katazuku 導入後に残る総秒(推計) */
  autoSec: number
  /** 削減できた総秒(推計) */
  savedSec: number
}

export interface Outcome {
  domains: OutcomeDomain[]
  /** 合計の削減秒(推計) */
  savedSec: number
  /** 手作業なら掛かった合計秒(推計) */
  manualSec: number
  /** katazuku 導入後に残る合計秒(推計) */
  autoSec: number
  // ---- 以下は実数(事実) ----
  totalEmails: number
  promo: number
  deadlines: number
  actions: number
  done: number
  activeCompanies: number
  interviews: number
  offers: number
}

export function computeOutcome(emails: InboxEmail[], companies: PipelineCompany[]): Outcome {
  const totalEmails = emails.length
  let promo = 0
  let deadlines = 0
  let actions = 0
  let done = 0
  for (const e of emails) {
    if (e.selectionKind === 'promo') promo++
    if (e.deadline) deadlines++
    if (e.needsAction) actions++
    if (e.status === 'done') done++
  }

  // 仕分けは全通が対象(宣伝と分かるのも「見て判断した」結果なので総数で数える)
  const counts: Record<DomainKey, number> = { sort: totalEmails, deadline: deadlines, action: actions }
  const domains: OutcomeDomain[] = (['sort', 'deadline', 'action'] as const).map((key) => {
    const count = counts[key]
    const manualSec = count * MANUAL_SEC[key]
    const autoSec = count * AUTO_SEC[key]
    return { key, label: DOMAIN_LABEL[key], count, manualSec, autoSec, savedSec: manualSec - autoSec }
  })

  const manualSec = domains.reduce((n, d) => n + d.manualSec, 0)
  const autoSec = domains.reduce((n, d) => n + d.autoSec, 0)

  let activeCompanies = 0
  let interviews = 0
  let offers = 0
  for (const c of companies) {
    if (c.stage === 'offer') offers++
    else if (c.stage !== 'closed') activeCompanies++
    if (c.stage === 'interview') interviews++
  }

  return {
    domains,
    savedSec: manualSec - autoSec,
    manualSec,
    autoSec,
    totalEmails,
    promo,
    deadlines,
    actions,
    done,
    activeCompanies,
    interviews,
    offers,
  }
}

/** 秒を「◯時間◯分」「◯分」に整形 */
export function formatDuration(totalSec: number): string {
  const min = Math.round(totalSec / 60)
  if (min < 60) return `${min}分`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h}時間` : `${h}時間${m}分`
}
