import type { Person } from '../types'
import { sameCompany } from './names'

/** 会った人の永続化(localStorage)。キーは people アプリの所有物 */
const STORAGE_KEY = 'katazuku-people/people'

export function loadPeople(): Person[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw !== null) return JSON.parse(raw) as Person[]
  } catch {
    // 壊れたデータは空扱い
  }
  return []
}

export function savePeople(people: Person[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(people))
}

/** id を採番する(他エントリと衝突しない prefix) */
export function newPersonId(): string {
  return `person-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

/** ある企業で会った人を名寄せして抽出する */
export function peopleForCompany(people: Person[], company: string): Person[] {
  return people.filter((p) => p.company && sameCompany(p.company, company))
}

/** 種別の選択肢(この順で表示・フィルタする) */
export const CATEGORIES = ['面接官', '学生', '社員', 'OB・OG', 'その他'] as const

/** 表示・保存時の既定種別。旧データで category 未設定のものはこれ扱い */
export const DEFAULT_CATEGORY = '面接官'

/** category が空/未設定なら既定を返す(表示・比較で使う) */
export function personCategory(p: { category?: string }): string {
  return p.category && p.category.trim() ? p.category.trim() : DEFAULT_CATEGORY
}

/** 任意のオブジェクトを Person に正規化する(id/updatedAt/欠損フィールドを補完) */
function coercePerson(raw: Partial<Person>): Person {
  const s = (v: unknown): string => (v == null ? '' : String(v))
  return {
    id: raw.id || newPersonId(),
    name: s(raw.name),
    company: s(raw.company),
    role: s(raw.role),
    category: personCategory(raw),
    metAt: s(raw.metAt),
    howMet: s(raw.howMet),
    notes: s(raw.notes),
    facePhoto: typeof raw.facePhoto === 'string' ? raw.facePhoto : undefined,
    followUp: Boolean(raw.followUp),
    updatedAt: raw.updatedAt || new Date().toISOString(),
  }
}

/** name+company が同一かどうか(企業名は名寄せ、空同士も一致とみなす) */
function isSamePerson(a: Person, b: Person): boolean {
  return a.name.trim() === b.name.trim() && sameCompany(a.company || '', b.company || '')
}

/**
 * インポート用の非破壊マージ。
 * incoming の各要素を Person に正規化し(id/updatedAt が無ければ生成)、
 * name+company が既存(および取り込み済み)と一致するものは追加しない。
 * 追加分を先頭に積んだ配列と追加件数を返す。
 */
export function mergePeople(
  existing: Person[],
  incoming: Partial<Person>[],
): { merged: Person[]; added: number } {
  const result = [...existing]
  let added = 0
  for (const raw of incoming) {
    const p = coercePerson(raw)
    if (!p.name.trim()) continue // 名前の無いものは取り込まない
    if (result.some((e) => isSamePerson(e, p))) continue // 重複は追加しない
    result.unshift(p)
    added++
  }
  return { merged: result, added }
}
