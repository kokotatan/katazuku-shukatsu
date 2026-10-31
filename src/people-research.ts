import type { DatabaseSync } from 'node:sqlite'
import { resolveCompany, upsertCompany } from './db.js'
import { transaction, upsertPerson } from './inputs.js'

export interface PeopleResearchInput {
  sourceRef: string
  researchedAt: string
  people: {
    name: string
    company?: string
    role?: string
    category?: string
    notes: string[]
    confidence?: number
  }[]
}

/** 調査結果も面談と同じ人物台帳へ入れる。就活生の大学を採用企業マスタへ追加しない。 */
export function applyPeopleResearch(
  db: DatabaseSync,
  input: PeopleResearchInput,
): { people: number; notes: number } {
  if (!input || typeof input.sourceRef !== 'string' || !input.sourceRef.trim()
    || !Number.isFinite(Date.parse(input.researchedAt)) || !Array.isArray(input.people) || !input.people.length) {
    throw new Error('出典・調査日時・人物が必要です')
  }
  if (input.sourceRef.length > 500 || input.people.length > 200) throw new Error('人物調査の入力が大きすぎます')
  for (const person of input.people) {
    if (!person || typeof person.name !== 'string' || !person.name.trim() || person.name.length > 200
      || !Array.isArray(person.notes) || person.notes.length > 100
      || !person.notes.every((note) => typeof note === 'string' && note.length <= 4_000)
      || (person.confidence !== undefined && (!Number.isFinite(person.confidence) || person.confidence < 0 || person.confidence > 1))) {
      throw new Error('人物と根拠の形式を確認してください')
    }
  }

  return transaction(db, () => {
    let notes = 0
    for (const person of input.people) {
      const peer = /就活生|学生|同級生|同期|友人|student|peer/i.test(person.category || '')
      let companyId: number | undefined
      if (!peer && person.company?.trim()) {
        const match = resolveCompany(db, person.company)
        if (match.kind === 'suspicious') throw new Error('所属企業の候補が複数あります。確認してから反映してください')
        companyId = match.kind === 'hit' ? match.companyId : upsertCompany(db, { name: person.company })
      }
      const id = upsertPerson(db, {
        name: person.name,
        companyId,
        company: person.company || '',
        role: person.role || '',
        category: person.category || 'その他',
      })
      for (const note of person.notes.filter((value) => value.trim())) {
        notes += Number(db.prepare(`
          INSERT OR IGNORE INTO person_note(person_id, at, note, source_ref, confidence)
          VALUES (?, ?, ?, ?, ?)
        `).run(id, input.researchedAt, note, input.sourceRef, person.confidence ?? 0.8).changes)
      }
    }
    return { people: input.people.length, notes }
  })
}
