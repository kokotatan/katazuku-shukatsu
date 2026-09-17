/**
 * アプリ群(board/status/inbox/...)が共有する、正本DBスナップショットの型と読み口。
 *
 * 個人データは静的ファイルへ置かず、本人が連携した保存先から取得する。
 */
import { viewer } from './connection'

import type { KatazukuData, Selection } from '../../src/viewer-types'
export type * from '../../src/viewer-types'

export async function fetchKatazukuData(signal?: AbortSignal): Promise<KatazukuData> {
  return await viewer.data(signal)
}

/**
 * 顔写真の実体はDBにもスナップショットにも入れず、storage_key だけを持つ。
 * 本体はこのキーを `/api/photo` で引くが、公開版は写真の配信口を持たない。
 * 実装するときはローカルの保管先を返すこと(鍵をURLに載せない)。
 */
export function photoUrl(_storageKey: string): string | null {
  return null
}

export function formatDate(value: string, withTime = true): string {
  if (!value) return '未設定'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date)
}

export function textValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join('、')
  if (typeof value === 'object') return Object.entries(value as Record<string, unknown>)
    .map(([key, child]) => `${key}: ${textValue(child)}`).filter((line) => !line.endsWith(': ')).join(' / ')
  if (typeof value === 'boolean') return value ? 'はい' : 'いいえ'
  return String(value)
}

/** 日付までの残り日数。負なら超過 */
export function daysLeft(d: Date): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(d)
  target.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86400000)
}

/** `2026-08-19` `2026/08/19 15:00` `2026-08-19T15:00:00+09:00` のいずれも受ける */
export function parseDate(v: string): Date | null {
  if (!v) return null
  if (/T\d{2}:\d{2}/.test(v)) {
    const iso = new Date(v)
    if (!Number.isNaN(iso.getTime())) return iso
  }
  const m = v.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0))
  return Number.isNaN(d.getTime()) ? null : d
}

/** 終了したトラック(不合格・辞退)か */
export function isClosed(s: Pick<Selection, 'outcome'>): boolean {
  return s.outcome === '不合格' || s.outcome === '辞退'
}
