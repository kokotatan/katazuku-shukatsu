/**
 * シート書き戻し(lib/sheet.ts)の動作チェック。
 * 実シートの構造(前置き行・2段ヘッダ・数式列・空きテンプレート行)を模して検証する。
 * 実行: cd pipeline && npx tsx scripts/check-sheet.ts
 */
import { desiredStatus, locateTable, planUpdates, type CellUpdate } from '../src/lib/sheet'
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

if (failed) {
  console.error(`\n${failed}件失敗`)
  process.exit(1)
}
console.log('\nすべて通過 🎉')
