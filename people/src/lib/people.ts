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

/**
 * metAt 先頭から「出会った年月」を YYYY-MM で導出する。取れなければ ''。
 * 例「2026-07 二次面接」「2026/7」「2026年7月」→「2026-07」。
 * 年の無い簡易表記(例「7/16 二次面接」)は年月を確定できないので '' を返す。
 */
export function metMonth(p: { metAt?: string }): string {
  const m = (p.metAt ?? '').trim().match(/^(\d{4})[-/年](\d{1,2})/)
  if (!m) return ''
  const month = Number(m[2])
  if (month < 1 || month > 12) return ''
  return `${m[1]}-${String(month).padStart(2, '0')}`
}

/** 登録済みの人から、実在する会社名の一覧を作る(重複除去・50音/コード順) */
export function distinctCompanies(people: { company?: string }[]): string[] {
  const set = new Set<string>()
  for (const p of people) {
    const c = (p.company ?? '').trim()
    if (c) set.add(c)
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'ja'))
}

/** 登録済みの人から、出会った年月(YYYY-MM)の一覧を作る(重複除去・新しい順) */
export function distinctMonths(people: { metAt?: string }[]): string[] {
  const set = new Set<string>()
  for (const p of people) {
    const m = metMonth(p)
    if (m) set.add(m)
  }
  return [...set].sort().reverse()
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

/** 文字列が非空(空白のみでない)か */
function nonEmpty(v: string | undefined): boolean {
  return !!v && v.trim() !== ''
}

/**
 * 一致した既存レコードを取り込み側の値でマージ更新する(新規追加はしない)。
 * - 文字列(role/metAt/howMet/notes/category): 既存が空のときだけ取り込み側で埋める(手動編集を尊重)
 * - facePhoto: 取り込み側が非空ならそれを採用(顔の後入れ・差し替えを許可)。空なら既存を残す
 * - followUp: 取り込み側の真偽値で更新
 * - id: 既存を維持 / updatedAt: 更新時刻(now)
 */
function mergeInto(existing: Person, incoming: Person, now: string): Person {
  return {
    id: existing.id,
    name: existing.name,
    company: existing.company,
    role: nonEmpty(existing.role) ? existing.role : incoming.role,
    category: nonEmpty(existing.category) ? existing.category : incoming.category,
    metAt: nonEmpty(existing.metAt) ? existing.metAt : incoming.metAt,
    howMet: nonEmpty(existing.howMet) ? existing.howMet : incoming.howMet,
    notes: nonEmpty(existing.notes) ? existing.notes : incoming.notes,
    facePhoto: nonEmpty(incoming.facePhoto) ? incoming.facePhoto : existing.facePhoto,
    followUp: incoming.followUp,
    updatedAt: now,
  }
}

/**
 * インポート用の非破壊マージ。
 * incoming の各要素を Person に正規化し(id/updatedAt が無ければ生成)、
 * name+company が既存と一致すれば「新規追加せず既存を更新」(mergeInto のルール)、
 * 一致しなければ先頭に新規追加する。名前の無いものは取り込まない。
 * 取り込みファイル内での重複(同名同社)は1件に集約する(件数には数えない)。
 * 追加分を先頭に積んだ配列と、追加件数・更新件数を返す。
 */
export function mergePeople(
  existing: Person[],
  incoming: Partial<Person>[],
  now: string = new Date().toISOString(),
): { merged: Person[]; added: number; updated: number } {
  const result = [...existing]
  const addedIds = new Set<string>() // この取り込みで新規追加した id(重複集約を更新件数に数えないため)
  let added = 0
  let updated = 0
  for (const raw of incoming) {
    const p = coercePerson(raw)
    if (!p.name.trim()) continue // 名前の無いものは取り込まない
    const idx = result.findIndex((e) => isSamePerson(e, p))
    if (idx === -1) {
      result.unshift(p)
      addedIds.add(p.id)
      added++
      continue
    }
    const target = result[idx]
    result[idx] = mergeInto(target, p, now)
    // 取り込み内での重複は集約するだけ。既存レコードの更新だけを件数に数える
    if (!addedIds.has(target.id)) updated++
  }
  return { merged: result, added, updated }
}
