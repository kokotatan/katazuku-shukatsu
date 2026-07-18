import { sameCompany } from './importer'

/**
 * people アプリで登録した「会った人」を読み取り専用で参照する。
 * localStorage キー `katazuku-people/people` は people 側の所有物なので、
 * ここでは絶対に書き込まない(読むだけ)。
 */
const PEOPLE_KEY = 'katazuku-people/people'

/** people の Person と同形。status では読み取りにのみ使う */
export interface Person {
  id: string
  name: string
  company: string
  role: string
  metAt: string
  howMet: string
  notes: string
  facePhoto?: string
  followUp: boolean
  updatedAt: string
}

function loadPeople(): Person[] {
  try {
    const raw = localStorage.getItem(PEOPLE_KEY)
    if (raw !== null) return JSON.parse(raw) as Person[]
  } catch {
    // 壊れたデータは空扱い
  }
  return []
}

/** ある企業で会った人を名寄せして抽出する(更新の新しい順) */
export function peopleForCompany(company: string): Person[] {
  return loadPeople()
    .filter((p) => p.company && sameCompany(p.company, company))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}
