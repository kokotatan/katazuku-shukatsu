/**
 * 企業研究を company_dossier へ格納する。根拠URLをsourcesへ必須化する。
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb } from '../src/db'
import { resolveSelectionId, transaction } from '../src/inputs'
import { resolveDatabasePath } from '../src/database-path'

interface ResearchSource { title: string; url: string; retrievedAt?: string }
interface ResearchInput {
  sourceRef: string
  company: string
  position?: string
  summary: string
  researchedAt: string
  facts: {
    business?: unknown
    customers?: unknown
    products?: unknown
    technology?: unknown
    financials?: unknown
    culture?: unknown
    risks?: unknown
    interviewAngles?: unknown
    [key: string]: unknown
  }
  sources: ResearchSource[]
}
const dbArgIndex = process.argv.indexOf('--db')
const DB_PATH = resolveDatabasePath(dbArgIndex >= 0 ? process.argv[dbArgIndex + 1] : undefined)

function validate(value: unknown): asserts value is ResearchInput {
  if (!value || typeof value !== 'object') throw new Error('入力はオブジェクトです')
  const input = value as ResearchInput
  for (const field of ['sourceRef', 'company', 'summary', 'researchedAt'] as const) {
    if (!String(input[field] || '').trim()) throw new Error(`${field} は必須です`)
  }
  if (!input.facts || typeof input.facts !== 'object') throw new Error('facts はオブジェクトです')
  if (!Array.isArray(input.sources) || input.sources.length === 0) throw new Error('sources は1件以上必要です')
  for (const source of input.sources) {
    if (!source.title || !/^https?:\/\//.test(source.url)) throw new Error('sources は title とURLが必須です')
  }
}

export function applyResearch(input: ResearchInput): { companyId: number } {
  const db = openDb(DB_PATH)
  return transaction(db, () => {
    const { companyId } = resolveSelectionId(db, input.company, input.position)
    db.prepare(`
      INSERT INTO company_dossier
        (company_id, summary, facts_json, sources_json, researched_at, source_ref)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(company_id) DO UPDATE SET
        summary = excluded.summary, facts_json = excluded.facts_json,
        sources_json = excluded.sources_json, researched_at = excluded.researched_at,
        source_ref = excluded.source_ref
    `).run(
      companyId, input.summary, JSON.stringify(input.facts), JSON.stringify(input.sources),
      input.researchedAt, input.sourceRef,
    )
    return { companyId }
  })
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && currentFile === resolve(process.argv[1])) {
  const file = process.argv[2]
  if (!file) throw new Error('使い方: npx tsx scripts/db-apply-research.ts <research.json>')
  const input: unknown = JSON.parse(readFileSync(resolve(file), 'utf8'))
  validate(input)
  console.log(JSON.stringify(applyResearch(input), null, 2))
}
