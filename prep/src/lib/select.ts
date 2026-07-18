import type { PrepEntry } from '../types'
import { sameCompany } from './names'

/** ある企業の直前モードで読む内容: 共通の軸 → その企業の想定問答 → その企業の振り返り */
export function focusDeck(entries: PrepEntry[], company: string): PrepEntry[] {
  const axes = entries.filter((e) => e.kind === 'axis')
  const ofCompany = (kind: PrepEntry['kind']) =>
    entries.filter((e) => e.kind === kind && e.company && sameCompany(e.company, company))
  return [...axes, ...ofCompany('qa'), ...ofCompany('retro')]
}

/** 企業ごとのエントリ数(一覧表示用)。企業名は名寄せして集約する */
export function companySummary(entries: PrepEntry[]): { company: string; count: number }[] {
  const groups: { company: string; count: number }[] = []
  for (const e of entries) {
    if (!e.company) continue
    const hit = groups.find((g) => sameCompany(g.company, e.company))
    if (hit) hit.count++
    else groups.push({ company: e.company, count: 1 })
  }
  return groups.sort((a, b) => b.count - a.count)
}

/** 横断の振り返り(新しい順)。同じ失敗の繰り返しに気づくための一覧 */
export function retrospectives(entries: PrepEntry[]): PrepEntry[] {
  return entries
    .filter((e) => e.kind === 'retro')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}
