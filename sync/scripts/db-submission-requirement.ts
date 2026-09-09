/** Gmail/会話から抽出した提出物を正本台帳へ冪等反映する専用入口。 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { openDb } from '../src/db'
import { resolveDatabasePath } from '../src/database-path'
import {
  applySubmissionRequirements,
  type SubmissionRequirementInput,
} from '../src/submission-requirement'

const args = process.argv.slice(2)
const file = args.find((arg) => !arg.startsWith('--'))
if (!file) throw new Error('使い方: db-submission-requirement.ts <requirements.json> [--db <path>]')
const dbIndex = args.indexOf('--db')
const dbPath = resolveDatabasePath(dbIndex >= 0 ? args[dbIndex + 1] : undefined)
const value: unknown = JSON.parse(readFileSync(resolve(file), 'utf8'))
const items = Array.isArray(value) ? value : (value as { requirements?: unknown[] })?.requirements
if (!Array.isArray(items)) throw new Error('入力は配列または {requirements:[...]} 形式です')
for (const [index, item] of items.entries()) {
  if (!item || typeof item !== 'object') throw new Error(`requirements[${index}] がobjectではありません`)
  const row = item as Partial<SubmissionRequirementInput>
  if (!row.sourceRef || !row.company || !row.kind || !row.title || !row.status) {
    throw new Error(`requirements[${index}] は sourceRef/company/kind/title/status が必須です`)
  }
}
const db = openDb(dbPath)
console.log(JSON.stringify(applySubmissionRequirements(db, items as SubmissionRequirementInput[]), null, 2))
