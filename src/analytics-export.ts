import type { DatabaseSync } from 'node:sqlite'
import { outcomeOf } from './db.js'

/** 外部分析へ渡せる最小単位。企業名、日付、自由記述、識別子は含めない。 */
export interface FunnelRow {
  stage: '応募前' | '応募済'
  outcome: '進行中' | '合格' | '不合格' | '辞退' | '内定'
  selection_count: number
}

const outcomes: FunnelRow['outcome'][] = ['進行中', '合格', '不合格', '辞退', '内定']

export function aggregateFunnel(db: DatabaseSync): FunnelRow[] {
  const rows = db.prepare('SELECT submitted, status FROM selection').all() as Array<{ submitted: number; status: string }>
  const counts = new Map<string, number>()
  for (const row of rows) {
    const stage = row.submitted === 1 ? '応募済' : '応募前'
    const rawOutcome = outcomeOf(row.status)
    const outcome = outcomes.find(value => value === rawOutcome) ?? '進行中'
    const key = `${stage}:${outcome}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return (['応募前', '応募済'] as const).flatMap(stage =>
    outcomes.map(outcome => ({ stage, outcome, selection_count: counts.get(`${stage}:${outcome}`) ?? 0 })),
  )
}

export function funnelCsv(rows: readonly FunnelRow[]): string {
  return ['stage,outcome,selection_count', ...rows.map(row => {
    if (!['応募前', '応募済'].includes(row.stage) || !outcomes.includes(row.outcome) ||
      !Number.isSafeInteger(row.selection_count) || row.selection_count < 0) {
      throw new Error('分析行が不正です')
    }
    return `${row.stage},${row.outcome},${row.selection_count}`
  })].join('\n') + '\n'
}
