import type { InboxEmail, PipelineCompany } from '../types'
import { AUTO_SEC, MANUAL_SEC } from './outcome'

/**
 * Inbox / Status の実データ(localStorage)から、月別の効果指標を集計する。
 * /impact は inbox と同一オリジンなので katazuku-inbox/emails を直接読める。
 */

export interface MonthBucket {
  /** 表示ラベル "7月" */
  label: string
  /** "2026-07" */
  ym: string
  emails: number
  deadlines: number
  promo: number
  actions: number
  done: number
  /** その月に削減した手作業(分・推計) */
  savedMin: number
}

export interface SelectionSlice {
  key: string
  label: string
  count: number
}

export interface Metrics {
  /** 直近12ヶ月 */
  months: MonthBucket[]
  selection: SelectionSlice[]
}

const SEL_LABEL: Record<string, string> = {
  selection: '選考',
  recruiting: '募集案内',
  activity: '課外活動',
  promo: '宣伝',
  other: '対象外',
  unknown: '未分類',
}
const SEL_ORDER = ['selection', 'recruiting', 'activity', 'promo', 'other', 'unknown']

function monthKey(iso: string): string | null {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function computeMetrics(emails: InboxEmail[], _companies: PipelineCompany[], now: Date): Metrics {
  // 直近12ヶ月の空バケツを用意
  const months: MonthBucket[] = []
  const idx = new Map<string, MonthBucket>()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const b: MonthBucket = { label: `${d.getMonth() + 1}月`, ym, emails: 0, deadlines: 0, promo: 0, actions: 0, done: 0, savedMin: 0 }
    months.push(b)
    idx.set(ym, b)
  }

  const selCount = new Map<string, number>()

  for (const e of emails) {
    // メール内訳(全期間)
    const sk = e.selectionKind ?? 'unknown'
    selCount.set(sk, (selCount.get(sk) ?? 0) + 1)

    // 受信月のバケツへ
    const mk = e.receivedAt ? monthKey(e.receivedAt) : null
    const b = mk ? idx.get(mk) : undefined
    if (b) {
      b.emails++
      if (e.deadline) b.deadlines++
      if (e.selectionKind === 'promo') b.promo++
      if (e.needsAction) b.actions++
    }
    // 片付けは完了月のバケツへ
    if (e.status === 'done') {
      const dk = e.doneAt ? monthKey(e.doneAt) : mk
      const db = dk ? idx.get(dk) : undefined
      if (db) db.done++
    }
  }

  // 月別の削減時間(outcome の手作業モデルを月別に適用)
  const savePerEmail = MANUAL_SEC.sort - AUTO_SEC.sort
  const savePerDeadline = MANUAL_SEC.deadline - AUTO_SEC.deadline
  const savePerAction = MANUAL_SEC.action - AUTO_SEC.action
  for (const b of months) {
    const sec = b.emails * savePerEmail + b.deadlines * savePerDeadline + b.actions * savePerAction
    b.savedMin = Math.round(sec / 60)
  }

  const selection: SelectionSlice[] = SEL_ORDER.filter((k) => (selCount.get(k) ?? 0) > 0).map((k) => ({
    key: k,
    label: SEL_LABEL[k],
    count: selCount.get(k)!,
  }))

  return { months, selection }
}
