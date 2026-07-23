/**
 * 人物(面接官・リクルーター等)の公開プロフェッショナル情報を person / person_note へ反映する。
 * 面接前の下調べ(試験官プリブリーフ)にも使える。db-apply-interview と違い面接記録は作らない。
 * name+company で冪等(既存なら空欄補完のみ)、person_note は source_ref+person で重複しない。
 *
 * 入力JSON: { company, sourceRef, people: [{ name, role?, category?, howMet?, followUp?, notes?: string[], confidence? }] }
 * 実行: cd sync && npx tsx scripts/db-apply-person.ts <person.json> [--db <path>]
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb, resolveCompany, upsertCompany } from '../src/db'
import { transaction, upsertPerson } from '../src/inputs'

interface PersonInput {
  name: string
  role?: string
  category?: string
  howMet?: string
  followUp?: string
  notes?: string[]
  confidence?: number
}
interface ApplyPersonInput {
  company: string
  sourceRef: string
  people: PersonInput[]
}

const dbArgIndex = process.argv.indexOf('--db')
const DB_PATH = dbArgIndex >= 0 ? resolve(process.argv[dbArgIndex + 1]) : (process.env.KATAZUKU_DB_PATH || join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'katazuku.db'))

function validate(value: unknown): asserts value is ApplyPersonInput {
  if (!value || typeof value !== 'object') throw new Error('入力はオブジェクトです')
  const input = value as ApplyPersonInput
  if (!String(input.company || '').trim()) throw new Error('company は必須です')
  if (!String(input.sourceRef || '').trim()) throw new Error('sourceRef は必須です')
  if (!Array.isArray(input.people) || input.people.length === 0) throw new Error('people は1件以上必要です')
  for (const p of input.people) {
    if (!String(p.name || '').trim()) throw new Error('people[].name は必須です')
  }
}

export function applyPerson(input: ApplyPersonInput, db = openDb(DB_PATH)): { created: number; notes: number } {
  return transaction(db, () => {
    // 企業名は名寄せhitを優先。未知なら新規登録(面接官は必ず所属先を持つ想定)
    const resolution = resolveCompany(db, input.company)
    const companyId = resolution.kind === 'hit' ? resolution.companyId : upsertCompany(db, { name: input.company })
    const result = { created: 0, notes: 0 }
    for (const person of input.people) {
      const before = db.prepare('SELECT id FROM person WHERE name = ? AND company_text = ?')
        .get(person.name.trim(), input.company.trim()) as { id: number } | undefined
      const personId = upsertPerson(db, {
        name: person.name,
        companyId,
        company: input.company,
        role: person.role ?? '',
        category: person.category ?? '面接官',
        howMet: person.howMet ?? '',
        followUp: person.followUp ?? '',
      })
      if (!before) result.created += 1
      for (const note of person.notes ?? []) {
        if (!note.trim()) continue
        const res = db.prepare(`
          INSERT OR IGNORE INTO person_note (person_id, at, note, source_ref, confidence)
          VALUES (?, ?, ?, ?, ?)
        `).run(personId, new Date().toISOString(), note, input.sourceRef, person.confidence ?? 0.85)
        if (res.changes) result.notes += 1
      }
    }
    return result
  })
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && currentFile === resolve(process.argv[1])) {
  const file = process.argv.slice(2).find((a) => !a.startsWith('--'))
  if (!file) throw new Error('使い方: npx tsx scripts/db-apply-person.ts <person.json> [--db <path>]')
  const input: unknown = JSON.parse(readFileSync(resolve(file), 'utf8'))
  validate(input)
  console.log(JSON.stringify(applyPerson(input), null, 2))
}
