/**
 * シート書き戻し(lib/sheet.ts)の動作チェック。
 * 実シートの構造(前置き行・2段ヘッダ・数式列・空きテンプレート行)を模して検証する。
 * 実行: cd pipeline && npx tsx scripts/check-sheet.ts
 */
import { desiredStatus, locateTable, planUpdates, type CellUpdate } from '../src/lib/sheet'
import { countPlannedChanges, MAX_APPLY_CHANGES } from './sheet-sync'
import type { Company, Stage } from '../src/types'

let failed = 0
function check(label: string, cond: boolean, detail = '') {
  console.log(`${cond ? '✅' : '❌'} ${label}${cond ? '' : ` — ${detail}`}`)
  if (!cond) failed++
}

// 実シートと同じ列構成: 企業名/業界/志望度/出願状況/選考①〜④/テスト種別/次回アクション/〆切・選考日/残り日数/提出済/…/メモ欄
const HEADER = ['企業名', '業界', '志望度', '出願状況', '選考①', '選考②', '選考③', '選考④', 'テスト種別', '次回アクション', '〆切・選考日', '【触らない】\n残り日数', '提出済', 'マイページURL', 'ID', 'pswd', 'ES ドキュメントURL', 'メモ欄']
const row = (
  name: string, status = '', nextAction = '', nextDate = '', industry = '', priority = '',
) => [name, industry, priority, status, '', '', '', '', '', nextAction, nextDate, '', 'FALSE', '', '', '', '', '']

const rows: string[][] = [
  ['月に一度更新しましょう！'],
  [],
  ['基本情報', '', '', '選考情報'],
  HEADER,
  row('LayerX', '合格', '', '', 'IT・通信', '第１志望群'),
  row('ネクストビート', '出願済', '', '6/12'),
  row('博報堂'),
  row('ギフティ（Giftee）', '出願済'),
  row('DeNA', '不合格'),
  row(''),
  row(''),
  HEADER, // 次の表(別シーズン)のヘッダ。ここから先は触らない
  row('別表の企業', ''),
]

const co = (name: string, stage: Stage, p: Partial<Company> = {}): Company => ({
  id: name, name, role: '', stage, nextAction: '', nextDate: null, memo: '', updatedAt: '', ...p,
})

// --- locateTable ---
const table = locateTable(rows)!
check('ヘッダ行を検出 (前置き行をスキップ)', table.headerRow === 3)
check('次の表の手前で打ち切る', table.endRow === 11)
check('列マッピング', table.cols.name === 0 && table.cols.status === 3 && table.cols.nextAction === 9 && table.cols.nextDate === 10)

// --- desiredStatus ---
check('合格は上書きしない (taskでも)', desiredStatus('task', '合格') === null)
check('不合格は上書きしない (internでも)', desiredStatus('intern', '不合格') === null)
check('出願予定→出願済 は前進', desiredStatus('task', '出願予定') === '出願済')
check('出願済→出願予定 への後退はしない', desiredStatus('scouted', '出願済') === null)
check('intern→合格を書く', desiredStatus('intern', '出願済') === '合格')
check('closed→辞退を書く', desiredStatus('closed', '出願済') === '辞退')

// --- planUpdates ---
const board: Company[] = [
  co('LayerX', 'task', { nextAction: '技術課題を提出(GitHub)', nextDate: '2026-06-29' }),
  co('株式会社ネクストビート', 'entried', { nextDate: '2026-06-12' }), // シートと同日付 → 日付更新なし
  co('株式会社博報堂', 'task', { industry: '広告・出版・マスコミ' }),
  co('ギフティ(Giftee)', 'interview'), // 半角カッコ vs シートの全角カッコ
  co('DeNA', 'closed'), // シートは不合格 → 触らない
  co('農林中央金庫', 'task', { nextAction: 'ESをマイページから提出', nextDate: '2026-06-15' }), // シートに無い → 追記
  co('株式会社タイミー', 'intern'), // シートに無い → 追記(空き行は2つ)
  co('PKSHA Technology', 'interview'), // 空き行が尽きて skipped
]
const plan = planUpdates(board, rows, table)
const at = (r: number, c: number): CellUpdate | undefined =>
  plan.updates.find((u) => u.row === r && u.col === c)

check('LayerX: 合格ステータスは維持', !at(4, 3))
check('LayerX: 次回アクションを書く', at(4, 9)?.value === '技術課題を提出(GitHub)')
check('LayerX: 〆切を書く', at(4, 10)?.value === '2026/06/29')
check('ネクストビート: 同じ日付は書き直さない', !at(5, 10))
check('博報堂: 出願状況を出願済に', at(6, 3)?.value === '出願済')
check('博報堂: 空欄の業界を補完', at(6, 1)?.value === '広告・出版・マスコミ')
check('全角カッコのギフティに名寄せできる', plan.updatedNames.some((n) => n.includes('ギフティ')) || !plan.addedNames.some((n) => n.includes('ギフティ')))
check('不合格のDeNAには何も書かない', plan.updates.every((u) => u.row !== 8))
check('農林中金を1つ目の空き行(10行目)に追記', at(9, 0)?.value === '農林中央金庫' && at(9, 3)?.value === '出願済')
check('タイミーを2つ目の空き行に追記', at(10, 0)?.value === '株式会社タイミー' && at(10, 3)?.value === '合格')
check('空き行が尽きたらskippedに回す', plan.skipped.length === 1 && plan.skipped[0] === 'PKSHA Technology')
check('別表(endRow以降)には書かない', plan.updates.every((u) => u.row < 11))
check('数式・チェック列(残り日数/提出済)に触れない', plan.updates.every((u) => u.col !== 11 && u.col !== 12))
check('メモ欄に触れない', plan.updates.every((u) => u.col !== 17))

// --- 新スキーマ(選考管理タブ・自由記述ステータス。空欄補完のみで手入力を潰さない) ---
const HEADER2 = ['企業名', '時期', 'ポジション', '志望度', 'ステータス', '次アクション', '締切・選考日', '残り日数', '提出済', 'ES・資料URL', '選考メモ']
const row2 = (name: string, status = '', nextAction = '', nextDate = '', priority = '') =>
  [name, '', '', priority, status, nextAction, nextDate, '', 'FALSE', '', '']
const rows2: string[][] = [
  HEADER2,
  row2('PKSHA', '人事面接済(7/16)', '3days/1dayの案内待ち'),
  row2('P&G', '選考中', 'SDS提出', '2026/07/16'),
  row2('空ステ社', '', '', ''),
  row2(''),
  row2(''),
]
const table2 = locateTable(rows2)!
check('新スキーマ: ステータス/次アクション/締切列を検出', table2.cols.status === 4 && table2.cols.nextAction === 5 && table2.cols.nextDate === 6)
check('新スキーマ: freeform=true', table2.freeform === true)
check('旧スキーマ: freeform=false', table.freeform === false)

const board2: Company[] = [
  co('PKSHA', 'interview', { nextAction: '上書きされてはいけない', nextDate: '2026-08-01' }),
  co('空ステ社', 'entried'), // ステータス空欄 → 補完される
  co('新規ソフト社', 'task', { nextAction: 'ES提出', nextDate: '2026-07-20' }), // 無い企業 → 追記
]
const plan2 = planUpdates(board2, rows2, table2)
const at2 = (r: number, c: number): CellUpdate | undefined =>
  plan2.updates.find((u) => u.row === r && u.col === c)

check('新: 手入力ステータスは上書きしない', !at2(1, 4))
check('新: 手入力の次アクションは上書きしない', !at2(1, 5))
check('新: 空欄ステータスは補完する', at2(3, 4)?.value === '出願済')
check('新: 無い企業を空き行に追記', at2(4, 0)?.value === '新規ソフト社' && at2(4, 4)?.value === '出願済')
check('新: 残り日数・提出済(数式/チェック)に触れない', plan2.updates.every((u) => u.col !== 7 && u.col !== 8))

// --- countPlannedChanges (--apply の書き込み上限ガード) ---
const fakePlan = (updated: number, added: number) => ({
  updatedNames: Array.from({ length: updated }, (_, i) => `更新社${i + 1}`),
  addedNames: Array.from({ length: added }, (_, i) => `追記社${i + 1}`),
})
check('上限ガード: 更新+追記の合計を数える', countPlannedChanges(fakePlan(9, 6)) === 15)
check('上限ガード: 実プランの件数と一致', countPlannedChanges(plan) === plan.updatedNames.length + plan.addedNames.length)
check('上限ガード: 上限ちょうど(15社)は超過しない', countPlannedChanges(fakePlan(10, 5)) <= MAX_APPLY_CHANGES)
check('上限ガード: 16社は超過と判定', countPlannedChanges(fakePlan(10, 6)) > MAX_APPLY_CHANGES)
check('上限ガード: 追記だけでも超過を検出', countPlannedChanges(fakePlan(0, 16)) > MAX_APPLY_CHANGES)
const planWithSkipped = { updatedNames: ['更新社'], addedNames: ['追記社'], skipped: ['空き行不足社A', '空き行不足社B'] }
check('上限ガード: skipped は件数に含めない', countPlannedChanges(planWithSkipped) === 2)

if (failed) {
  console.error(`\n${failed}件失敗`)
  process.exit(1)
}
console.log('\nすべて通過 🎉')
