/**
 * 選考管理シート取込(lib/importer.ts)の動作チェック。
 * 個人実データには依存せず、このファイル内に定義したサンプルデータだけで自己完結する。
 * 検証する不変条件:
 *   - 表記ゆれの名寄せ(「株式会社」有無など)と短名の完全一致
 *   - 既存カードのステージ・期限は取込で上書きしない(ユーザーが育てた値を壊さない)
 *   - 空欄の項目(業界・職種など)だけを補完する
 *   - シートに無い企業は新規カードとして追加する
 * 実行: cd status && npx tsx scripts/check-import.ts
 */
import { mergeImport, sameCompany } from '../src/lib/importer'
import { makeInitialCompanies } from '../src/lib/demo'
import { STAGES, type Company } from '../src/types'

let failed = 0
function check(label: string, cond: boolean, detail = '') {
  console.log(`${cond ? '[OK]' : '[NG]'} ${label}${cond ? '' : ` — ${detail}`}`)
  if (!cond) failed++
}

// --- 単体: 同一企業判定(実社名を使わず、判定ロジックそのものを検証する) ---
check('表記ゆれは同一視(株式会社の有無)', sameCompany('株式会社サンプルソフト', 'サンプルソフト'))
check('部分文字列は同一視(グループ表記)', sameCompany('サンプルテックグループ', '株式会社サンプルテック'))
check('短い名前は完全一致のみ(Go≠Google)', !sameCompany('Go', 'Google'))
check('別語は同一視しない(商事≠不動産)', !sameCompany('サンプル商事', 'サンプル不動産'))

// --- 取込データ(インラインのサンプル。実データファイルには依存しない) ---
// 初期ボード(makeInitialCompanies)の一部と名寄せさせ、既存カードを壊さず補完だけ行うことを確認する。
type ImportRow = { name: string; stage?: string; nextAction?: string; nextDate?: string; role?: string; industry?: string; memo?: string }
const data: ImportRow[] = [
  // 既存 sample-c(株式会社サンプルソフト / stage=task / nextDate=2026-06-29)に名寄せ。
  // 取込側は別ステージ・別期限・業界付きだが、既存のステージ/期限は維持し、空欄の業界だけ補完されるはず。
  { name: 'サンプルソフト', stage: 'interview', nextDate: '2026-07-01', industry: 'IT・通信', memo: 'サンプル: 取込メモ追記の確認用' },
  // 既存 sample-a(株式会社サンプルテック)にグループ表記で名寄せ。重複カードを作らないことの確認。
  { name: 'サンプルテックグループ', stage: 'scouted', industry: 'IT・通信' },
  // シートに無い新規企業。新規カードとして追加されるはず。
  { name: '株式会社サンプル新規商事', stage: 'entried', role: '総合職', nextAction: 'ESを提出', nextDate: '2026-07-05', industry: '商社' },
  { name: 'サンプル新規物産株式会社', stage: 'scouted', nextAction: '本エントリーを検討', industry: '商社' },
]

// 取込ファイル内に互いにマージされてしまうペアがないか(1社=1カードの前提が崩れる)
const collisions: string[] = []
for (let i = 0; i < data.length; i++) {
  for (let j = i + 1; j < data.length; j++) {
    if (sameCompany(data[i].name, data[j].name)) collisions.push(`${data[i].name} <-> ${data[j].name}`)
  }
}
check('取込データ内に名寄せ衝突なし', collisions.length === 0, collisions.join(', '))

const board = makeInitialCompanies()
const result = mergeImport(board, data)

const validStages = new Set(STAGES.map((s) => s.key))
check('全カードのステージが妥当', result.companies.every((c) => validStages.has(c.stage)))

// 既存 sample-c(株式会社サンプルソフト)は「更新扱い」になる。ステージ・期限は維持されること。
const soft = result.companies.filter((c) => sameCompany(c.name, '株式会社サンプルソフト'))
check('サンプルソフトが重複しない', soft.length === 1)
check('既存サンプルソフトのステージ(task)を維持', soft[0].stage === 'task')
check('既存サンプルソフトの期限を維持', soft[0].nextDate === '2026-06-29')
check('サンプルソフトに業界が補完される', soft[0].industry === 'IT・通信')
check('サンプルソフトのメモが追記される', soft[0].memo.includes('取込メモ追記の確認用'))

// 既存 sample-a(株式会社サンプルテック)もグループ表記から名寄せされ、重複しないこと。
const tech = result.companies.filter((c) => sameCompany(c.name, '株式会社サンプルテック'))
check('サンプルテックが重複しない', tech.length === 1)

// シートに無い企業は新規追加される。
const added1 = result.companies.filter((c) => sameCompany(c.name, '株式会社サンプル新規商事'))
check('新規企業(サンプル新規商事)が追加される', added1.length === 1)
check('新規追加は取込どおりのステージになる', added1[0]?.stage === 'entried')

check('取込件数(新規2社)', result.added === 2, `added=${result.added}`)
check(
  '追加+既存 = 取込後の総数',
  result.companies.length === board.length + result.added,
  `board=${board.length} added=${result.added} total=${result.companies.length}`,
)
console.log(
  `\n取込結果: 新規 ${result.added}社 / 既存補完 ${result.enriched}社 / 合計 ${result.companies.length}社`,
)
for (const s of STAGES) {
  console.log(`  ${s.label}: ${result.companies.filter((c: Company) => c.stage === s.key).length}社`)
}

if (failed) {
  console.error(`\n${failed}件失敗`)
  process.exit(1)
}
console.log('\nすべて通過')
