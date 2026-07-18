import type { DatabaseSync } from 'node:sqlite'
import { insertSelection, resolveCompany, samePosition, upsertCompany } from './db'

export function resolveSelectionId(
  db: DatabaseSync,
  company: string,
  position = '',
  create = true,
): { selectionId: number; companyId: number } {
  const name = company.trim()
  if (!name) throw new Error('company は必須です')
  const resolution = resolveCompany(db, name)
  if (resolution.kind === 'suspicious') {
    throw new Error(`企業名の確認が必要です: ${name} (候補: ${resolution.suggestName})`)
  }
  const companyId = resolution.kind === 'hit' ? resolution.companyId : upsertCompany(db, { name })
  const rows = db.prepare('SELECT id, position FROM selection WHERE company_id = ? ORDER BY id')
    .all(companyId) as { id: number; position: string }[]
  if (position) {
    const exact = rows.find((row) => samePosition(row.position, position))
    if (exact) return { selectionId: exact.id, companyId }
  } else if (rows.length === 1) {
    return { selectionId: rows[0].id, companyId }
  } else if (rows.length > 1) {
    throw new Error(`複数トラックのため position が必要です: ${name}`)
  }
  if (!create) throw new Error(`選考トラックが見つかりません: ${name} ${position}`)
  const selectionId = insertSelection(db, companyId, {
    company: name,
    season: '',
    position,
    priority: '',
    status: '選考中',
    steps: [],
    nextAction: '',
    nextDate: '',
    submitted: false,
    esUrl: '',
    memo: '外部入力から自動作成',
  }, 'agent-input')
  return { selectionId, companyId }
}

export function upsertPerson(
  db: DatabaseSync,
  person: {
    name: string
    companyId?: number
    company?: string
    role?: string
    category?: string
    metAt?: string
    howMet?: string
    followUp?: string
  },
): number {
  const name = person.name.trim()
  if (!name) throw new Error('person.name は必須です')
  const companyText = (person.company || '').trim()
  const now = new Date().toISOString()
  const found = db.prepare('SELECT id FROM person WHERE name = ? AND company_text = ?')
    .get(name, companyText) as { id: number } | undefined
  if (found) {
    db.prepare(`
      UPDATE person SET
        company_id = COALESCE(company_id, ?),
        role = CASE WHEN role = '' THEN ? ELSE role END,
        category = CASE WHEN category = '' THEN ? ELSE category END,
        met_at = CASE WHEN met_at = '' THEN ? ELSE met_at END,
        how_met = CASE WHEN how_met = '' THEN ? ELSE how_met END,
        follow_up = CASE WHEN ? <> '' THEN ? ELSE follow_up END,
        updated_at = ?
      WHERE id = ?
    `).run(
      person.companyId ?? null,
      person.role ?? '',
      person.category ?? '',
      person.metAt ?? '',
      person.howMet ?? '',
      person.followUp ?? '',
      person.followUp ?? '',
      now,
      found.id,
    )
    return found.id
  }
  const result = db.prepare(`
    INSERT INTO person
      (name, company_id, company_text, role, category, met_at, how_met, follow_up, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name,
    person.companyId ?? null,
    companyText,
    person.role ?? '',
    person.category ?? '',
    person.metAt ?? '',
    person.howMet ?? '',
    person.followUp ?? '',
    now,
  )
  return Number(result.lastInsertRowid)
}

export function transaction<T>(db: DatabaseSync, action: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = action()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
