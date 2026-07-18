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
