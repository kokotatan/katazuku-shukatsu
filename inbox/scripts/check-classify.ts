// 取り込みJSONを実際に分類して結果を一覧表示する動作確認スクリプト
// 実行: npx tsx scripts/check-classify.ts
import { readFileSync } from 'node:fs'
import { classifyEmail } from '../src/lib/classify'
import { formatDateShort, formatRemaining } from '../src/lib/dates'
import type { RawEmail } from '../src/types'

const raws = JSON.parse(
  readFileSync(new URL('../gmail-import-2026-06-11.json', import.meta.url), 'utf-8'),
) as Array<Omit<RawEmail, 'source'>>

const now = new Date('2026-06-11T07:00:00Z')
const emails = raws.map((r) => classifyEmail({ ...r, source: 'import' }, now))

const needAction = emails.filter((e) => e.needsAction)
const kinds = { selection: 0, recruiting: 0, promo: 0, other: 0 }
for (const e of emails) kinds[e.selectionKind]++
console.log(
  `総数: ${emails.length} / 要対応: ${needAction.length} / 🎯選考: ${kinds.selection} 📣募集案内: ${kinds.recruiting} 📰宣伝: ${kinds.promo} ・対象外: ${kinds.other}\n`,
)

const KIND_ICON = { selection: '🎯', recruiting: '📣', promo: '📰', other: '・' }
for (const e of emails) {
  const dl = e.deadline
    ? `${formatDateShort(new Date(e.deadline))} (${formatRemaining(new Date(e.deadline), now)}) [${e.deadlineKind}]`
    : '-'
  console.log(
    `${e.needsAction ? '🔥' : '  '}${KIND_ICON[e.selectionKind]} [${e.category.padEnd(9)}] ${e.company} | ${e.subject.slice(0, 30)}`,
  )
  console.log(`     締切: ${dl} / ヒント: ${e.actionHint ?? '-'}`)
  if (e.actionSteps.length || e.actionUrl) {
    console.log(
      `     やること: ${e.actionSteps.join('・') || '-'}${e.actionUrl ? ` / 🔗 ${e.actionUrl.slice(0, 60)}` : ''}`,
    )
  }
}
