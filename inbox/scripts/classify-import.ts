// 取り込みJSON(RawEmail[])を分類して、アプリのlocalStorage形式(Email[])に変換する汎用スクリプト
// 実行: npx tsx scripts/classify-import.ts <入力JSON> <出力JSON>
// 変換は App.tsx の importRaws / importJson と同じ: classifyEmail(r) をそのまま適用する
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { classifyEmail } from '../src/lib/classify'
import { CATEGORY_META, type Category, type Email, type RawEmail } from '../src/types'

const [inputPath, outputPath] = process.argv.slice(2)
if (!inputPath || !outputPath) {
  console.error('使い方: npx tsx scripts/classify-import.ts <入力JSON> <出力JSON>')
  process.exit(1)
}

// App.tsx の toRaws と同じ許容度で欠けたフィールドを埋める。
// source はアプリと違い、入力に正しい値があればそれを保つ(gmail取込ファイルを想定)
const toRaws = (data: unknown): RawEmail[] => {
  if (!Array.isArray(data)) throw new Error('入力が配列のJSONではありません')
  return (data as Array<Record<string, unknown>>).map((d, i) => ({
    id: String(d.id ?? `import-${Date.now()}-${i}`),
    from: String(d.from ?? ''),
    fromAddress: String(d.fromAddress ?? d.from_address ?? ''),
    subject: String(d.subject ?? '(件名なし)'),
    body: String(d.body ?? ''),
    receivedAt: String(d.receivedAt ?? d.received_at ?? new Date().toISOString()),
    source: d.source === 'gmail' || d.source === 'demo' ? d.source : 'import',
  }))
}

const raws = toRaws(JSON.parse(readFileSync(resolve(inputPath), 'utf-8')))
const emails: Email[] = raws.map((r) => classifyEmail(r))
writeFileSync(resolve(outputPath), JSON.stringify(emails, null, 2) + '\n', { encoding: 'utf-8' })

// 件数と統計のみを表示する(件名・本文は出さない)
const byCategory = {} as Record<Category, number>
for (const key of Object.keys(CATEGORY_META) as Category[]) byCategory[key] = 0
const byKind: Record<string, number> = {}
let needsAction = 0
let withDeadline = 0
for (const e of emails) {
  byCategory[e.category]++
  byKind[e.selectionKind] = (byKind[e.selectionKind] ?? 0) + 1
  if (e.needsAction) needsAction++
  if (e.deadline) withDeadline++
}

console.log(`変換完了: ${emails.length} 件 -> ${outputPath}`)
console.log('カテゴリ別:')
for (const key of Object.keys(CATEGORY_META) as Category[]) {
  console.log(`  ${key} (${CATEGORY_META[key].label}): ${byCategory[key]}`)
}
console.log(`selectionKind別: ${JSON.stringify(byKind)}`)
console.log(`要対応 (needsAction): ${needsAction}`)
console.log(`締切あり (deadline): ${withDeadline}`)
