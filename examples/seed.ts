/**
 * seed: 正本DBに「1件の例」だけを入れて、スキーマの形を示すデモ。
 *
 * これは実データではありません。列が何を持つか(ラベル)と、その1例を見せるためのものです。
 * 実運用では、この表を埋めるのはエージェント(メール・会話・面接・提出結果・カレンダー由来)です。
 *
 *   npm run seed            # :memory: に1件入れて表示
 *   npm run seed -- ./demo.db   # ファイルに書き出して中身を確認できる
 */
import { openDb, upsertCompany, insertSelection, addAppointment, listSelections } from '../src/db'

const path = process.argv[2] ?? ':memory:'
const db = openDb(path)

// 企業(1例)
const companyId = upsertCompany(db, { name: 'Example Inc.', industry: '（業界）' })

// 選考トラック(1例)。status は自由記述、nextAction は次の一手。
insertSelection(db, companyId, {
  company: 'Example Inc.',
  season: '（季節: 夏 / 冬 / 本選考 など）',
  position: '（職種）',
  priority: 'A',
  status: '（ステータスの自由記述。例: 一次面接済）',
  steps: ['ES', '適性検査', '一次面接'],
  nextAction: '（次の行動。例: 二次面接の日程調整）',
  nextDate: '2026-07-05',
  submitted: true,
  esUrl: '',
  memo: '（メモ）',
})

// 予定(1例)。時刻・会議URL・相手まで構造化して持つ。
const sel = listSelections(db).find((s) => s.company === 'Example Inc.')!
addAppointment(db, {
  selectionId: sel.id,
  at: '2026-07-05T14:00:00+09:00',
  endAt: '2026-07-05T15:00:00+09:00',
  kind: 'interview',
  title: '（予定名。例: 二次面接）',
  url: 'https://example.com/meeting',
})

console.log('スキーマの1例を組み立てました:')
for (const s of listSelections(db)) {
  console.log(`  企業: ${s.company}`)
  console.log(`  選考: ${s.season} / ${s.position}（優先度 ${s.priority}）`)
  console.log(`  状態: ${s.status}`)
  console.log(`  次の行動: ${s.nextAction}（${s.nextDate}）`)
}
if (path !== ':memory:') console.log(`\n${path} に書き出しました。`)
