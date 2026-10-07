/**
 * 録音機で作った面談バンドルを、正本DBのある機械で検査して反映する。
 *   npx tsx scripts/interview-bundle-apply.ts <bundle.zip | 展開済みディレクトリ> [--db <path>]
 *   npm run interview:apply -- <bundle.zip>
 *
 * 正本DBの場所は --db > KATAZUKU_DB > <リポジトリ>/data/katazuku.db。
 * 同じバンドルを何度反映しても、runId で冪等になる(2回目は created=false)。
 * 流れと前提は docs/INTERVIEW-BUNDLE.md。
 */
import { applyInterviewBundleFile } from '../src/interview-bundle-apply.js'

const args = process.argv.slice(2)
const dbIndex = args.indexOf('--db')
const dbPath = dbIndex >= 0 ? args[dbIndex + 1] : undefined
const target = args.find((arg, index) => !arg.startsWith('--') && !(dbIndex >= 0 && index === dbIndex + 1))
if (!target || (dbIndex >= 0 && !dbPath)) {
  console.error('使い方: interview-bundle-apply.ts <bundle.zip | 展開済みディレクトリ> [--db <path>]')
  process.exit(1)
}

try {
  const outcome = applyInterviewBundleFile(target, { dbPath })
  for (const warning of outcome.warnings) console.warn(`[注意] ${warning}`)
  console.log(JSON.stringify(outcome, null, 2))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
