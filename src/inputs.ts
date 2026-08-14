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
  // 表記ゆれ名寄せ(2026-07-28: 「小久保/小久保さん/小久保慶人」等が別人登録され1人物が4行に割れた反省)。
  // 敬称・空白を落として正規化し、同じ会社の中で「完全一致 or 片方向包含(2文字以上)」を同一人物とみなす。
  // 候補が複数に割れたときだけ安全側(新規作成)に倒す。
  const normName = (s: string) => s.replace(/(さん|様|氏|先生|くん|君)$/u, '').replace(/[\s　]+/gu, '')
  const normCompany = (s: string) => s.replace(/[\s　]+/gu, '').replace(/株式会社|合同会社|\(株\)|（株）/gu, '')
  const nameKey = normName(name)
  const companyKey = normCompany(companyText)
  const candidates = (db.prepare(
    'SELECT id, name, company_id, company_text FROM person',
  ).all() as { id: number; name: string; company_id: number | null; company_text: string }[])
    .filter((p) => {
      if (person.companyId != null && p.company_id != null) return p.company_id === person.companyId
      const ck = normCompany(p.company_text)
      if (!companyKey || !ck) return companyKey === ck
      return ck === companyKey || ck.includes(companyKey) || companyKey.includes(ck)
    })
    .filter((p) => {
      const pk = normName(p.name)
      if (!pk || !nameKey) return false
      if (pk === nameKey) return true
      const shorter = pk.length <= nameKey.length ? pk : nameKey
      const longer = pk.length <= nameKey.length ? nameKey : pk
      return shorter.length >= 2 && longer.includes(shorter)
    })
  const exact = candidates.filter((p) => normName(p.name) === nameKey)
  const found = exact.length >= 1 ? exact[0] : candidates.length === 1 ? candidates[0] : undefined
  if (found) {
    // より情報量の多い名前(敬称なしで長い方)へ昇格させる。短い別名で上書きはしない
    const cleanedInput = name.replace(/(さん|様|氏|先生|くん|君)$/u, '').trim()
    if (normName(cleanedInput).length > normName(found.name).length) {
      db.prepare('UPDATE OR IGNORE person SET name = ? WHERE id = ?').run(cleanedInput, found.id)
    }
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
