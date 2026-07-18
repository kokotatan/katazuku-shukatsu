/**
 * 正本DB(src/db.ts)と日次反映(db-apply)・ミラー(db-mirror)の動作チェック。
 * インメモリSQLiteで実行。実行: cd sync && npx tsx scripts/check-db.ts
 */
import { DatabaseSync } from 'node:sqlite'
import { openDb, upsertCompany, insertSelection, listSelections, listCompanies, listEvents, transition, sameCompany, resolveCompany, addAlias, listPending } from '../src/db'
import { applyDiff } from './db-apply'
import { renderMirror } from './db-mirror'

let failed = 0
function check(label: string, cond: boolean, detail = '') {
  console.log(`${cond ? '✅' : '❌'} ${label}${cond ? '' : ` — ${detail}`}`)
  if (!cond) failed++
}

// openDbは:memory:でも動く(mkdirはdirname='.'で無害)
const db: DatabaseSync = openDb(':memory:')

// --- transition(遷移規則) ---
check('八洲問題: 合格でも辞退の根拠があれば確定する', transition('合格', 'closed') === '辞退')
check('終了済(不合格)は復活させない', transition('不合格', 'intern') === null)
check('終了済(辞退)は動かさない', transition('辞退', 'entried') === null)
check('詳しい手書きステータスを粗い「出願済」で潰さない', transition('人事面接済(7/16)', 'entried') === null)
check('進行中の手書きに合格の根拠→確定に進める', transition('人事面接済(7/16)', 'intern') === '合格')
check('「人事面接合格→対面面接」は既に確定扱い(内定根拠なしでは触らない)', transition('人事面接合格→対面面接', 'intern') === null)
check('空欄→出願済を書く', transition('', 'entried') === '出願済')
check('出願予定→出願済は前進', transition('出願予定', 'task') === '出願済')
check('出願済→出願予定への後退はしない', transition('出願済', 'scouted') === null)
check('同値は書かない', transition('出願済', 'entried') === null)
// codexレビュー(2026-07-18)の反例
check('codex反例: 途中経過の「面接合格」があっても内定は確定できる', transition('人事面接合格→対面面接', 'offer') === '内定')
check('「辞退予定」は本人意思なので内定通知でも上書きしない', transition('合格→本人辞退予定', 'offer') === null)
check('codex反例: 不合格メールは「辞退」でなく「不合格」と書く', transition('選考中', 'rejected') === '不合格')
check('codex反例: 合格→不合格の確定もできる', transition('合格', 'rejected') === '不合格')
check('codex反例: 不合格済に内定は書かない(復活なし)', transition('不合格', 'offer') === null)

// --- upsertCompany(名寄せ・空欄補完) ---
const idA = upsertCompany(db, { name: 'ネクストビート', industry: '' })
const idB = upsertCompany(db, { name: '株式会社ネクストビート', industry: 'IT・通信' })
check('株式会社の有無で同一企業に名寄せ', idA === idB)
check('空欄の業界は後から補完される', listCompanies(db).find((c) => sameCompany(c.name, 'ネクストビート'))?.industry === 'IT・通信')
const before = listCompanies(db).length
upsertCompany(db, { name: 'Go' })
upsertCompany(db, { name: 'Google' })
check('短い名前(Go≠Google)は別企業', listCompanies(db).length === before + 2)
upsertCompany(db, { name: 'トヨタ・コニック・プロ' })
upsertCompany(db, { name: 'トヨタ' })
check('トヨタ≠トヨタ・コニック・プロ(3文字は完全一致のみ)', listCompanies(db).length === before + 4)
check('sameCompany: タイミーの表記ゆれは同一視のまま', sameCompany('株式会社タイミー', 'タイミー'))

// --- applyDiff(日次反映) ---
const yashimaId = upsertCompany(db, { name: '八洲電機' })
insertSelection(db, yashimaId, { company: '八洲電機', season: '夏', position: '', priority: '', status: '合格', steps: [], nextAction: '', nextDate: '', submitted: false, esUrl: '', memo: '' })
const pkshaId = upsertCompany(db, { name: 'PKSHA' })
insertSelection(db, pkshaId, { company: 'PKSHA', season: '夏', position: 'ビジネス職', priority: '', status: '人事面接済(7/16)', steps: ['面談', '人事面接'], nextAction: '案内待ち', nextDate: '', submitted: false, esUrl: '', memo: '' })
insertSelection(db, pkshaId, { company: 'PKSHA', season: '夏', position: 'アルゴリズム', priority: '', status: '書類選考中', steps: ['書類'], nextAction: '', nextDate: '', submitted: false, esUrl: '', memo: '' })

const res = applyDiff(db, [
  { name: '八洲電機', stage: 'closed' },                                  // 合格→辞退の確定
  { name: 'PKSHA', stage: 'entried' },                                    // 2トラックで特定不能→保留
  { name: 'PKSHA', stage: 'interview', position: 'アルゴリズム', nextAction: '面接日程を回答' }, // 位置指定あり→更新
  { name: '新規テスト社', stage: 'task', nextAction: 'ES提出', nextDate: '2026-07-25', season: '夏' }, // 新規追加
])
const sels = listSelections(db)
const yashima = sels.find((s) => s.company === '八洲電機')!
const pkshaBiz = sels.find((s) => s.company === 'PKSHA' && s.position === 'ビジネス職')!
const pkshaAlg = sels.find((s) => s.company === 'PKSHA' && s.position === 'アルゴリズム')!
const fresh = sels.find((s) => s.company === '新規テスト社')!

check('apply: 八洲が辞退に確定', yashima.status === '辞退')
check('apply: 複数トラックはposition無指定なら保留', res.skipped.includes('PKSHA') && pkshaBiz.status === '人事面接済(7/16)')
check('apply: position指定ありは該当トラックだけ更新', pkshaAlg.nextAction === '面接日程を回答')
check('apply: 手書きステータスは維持(選考中で潰さない)', pkshaAlg.status === '書類選考中')
check('apply: 新規企業はトラックごと追加される', fresh !== undefined && fresh.status === '出願済' && fresh.nextDate === '2026-07-25')
check('apply: 結果集計(更新2/追加1/保留1)', res.updated.length === 2 && res.added.length === 1 && res.skipped.length === 1)

// --- 名寄せの学習(2026-07-18本人方針: 正式名称ベース+怪しければ確認→学習) ---
const gifId = upsertCompany(db, { name: 'ギフティ' })
check('resolve: 正規化一致は確定', resolveCompany(db, 'ギフティ').kind === 'hit')
check('resolve: 部分一致どまりは「怪しい」(自動マージしない)', resolveCompany(db, 'ギフティ（Giftee）').kind === 'suspicious')
const resPend = applyDiff(db, [{ name: 'ギフティ（Giftee）', stage: 'entried' }])
check('apply: 怪しい名寄せはDBに書かず要確認に積む', resPend.pending.length === 1 && listPending(db).some((p) => p.name === 'ギフティ（Giftee）'))
check('apply: 要確認のときselectionは増えない', listSelections(db).every((s) => s.company !== 'ギフティ（Giftee）'))
addAlias(db, 'ギフティ（Giftee）', 'ギフティ')
check('alias学習後は確定になる', resolveCompany(db, 'ギフティ（Giftee）').kind === 'hit')
check('alias学習で要確認が解決済みになる', !listPending(db).some((p) => p.name === 'ギフティ（Giftee）'))
const resAfter = applyDiff(db, [{ name: 'ギフティ（Giftee）', stage: 'entried' }])
check('学習後のapplyは正式名称の企業に入る', resAfter.added.length === 1 && upsertCompany(db, { name: 'ギフティ' }) === gifId)

// --- イベント起点(2026-07-18本人方針: 状態変化は必ずイベントとして残る) ---
const yashimaEvents = listEvents(db).filter((e) => e.summary.includes('辞退'))
check('event: 八洲の合格→辞退がイベントとして記録されている', yashimaEvents.some((e) => e.kind === '状態変化' && e.summary === '合格 → 辞退'))
check('event: 新規登録もイベントになる', listEvents(db).some((e) => e.kind === '新規'))
check('event: 予定更新もイベントになる', listEvents(db).some((e) => e.kind === '予定更新' && e.summary.includes('面接日程を回答')))

// codex反例: 既存1トラックの企業に「別ポジション」の情報が来たら、既存を書き換えず新トラックとして追加する
const sansanId = upsertCompany(db, { name: 'Sansan' })
insertSelection(db, sansanId, { company: 'Sansan', season: '夏', position: '', priority: '', status: '参加確定 7/19-22', steps: [], nextAction: '', nextDate: '', submitted: false, esUrl: '', memo: '' })
const res2 = applyDiff(db, [{ name: 'Sansan', stage: 'intern', position: '1day', season: '夏' }])
const sansans = listSelections(db).filter((s) => s.company === 'Sansan')
check('codex反例: position不一致は既存トラックを書き換えない', sansans.find((s) => s.position === '')?.status === '参加確定 7/19-22')
check('codex反例: 別ポジションは新トラックとして追加される', res2.added.length === 1 && sansans.some((s) => s.position === '1day' && s.status === '合格'))

// --- renderMirror(シートへの一方向ミラー) ---
const writes = renderMirror(db)
const selChunks = writes.filter((w) => w.tab.includes('選考管理'))
const coChunks = writes.filter((w) => w.tab.includes('企業マスタ'))
const selAll = selChunks.flatMap((w) => w.values)
const coAll = coChunks.flatMap((w) => w.values)
const dataRows = selAll.slice(1).filter((r) => r[0])
check('mirror: 選考タブのヘッダが15列(A..O)', selAll[0].length === 15 && selAll[0][0] === '企業名')
check('mirror: 全selectionが行になる', dataRows.length === listSelections(db).length)
const yRow = selAll.findIndex((r) => r[0] === '八洲電機')
check('mirror: ステータスがE列に出る', selAll[yRow][4] === '辞退')
check('mirror: 残り日数は行番号入りの数式', selAll[yRow][11].startsWith('=ifs(') && selAll[yRow][11].includes(`$K${yRow + 1}`) && selAll[yRow][11].includes(`$M${yRow + 1}`))
check('mirror: 提出済はTRUE/FALSE文字列', dataRows.every((r) => r[12] === 'TRUE' || r[12] === 'FALSE'))
check('mirror: 50行チャンクで全201行を覆う', selAll.length === 201 && selChunks[0].range.startsWith('A1:') && selChunks[selChunks.length - 1].range.endsWith('O201'))
check('mirror: チャンクのrangeが行番号と一致', selChunks.every((w, i) => w.range === `A${i * 50 + 1}:O${i * 50 + w.values.length}`))
check('mirror: 企業タブは6列で全社ぶん', coAll[0].length === 6 && coAll.slice(1).filter((r) => r[0]).length === listCompanies(db).length)

// codex反例: データ由来の「=」始まりを数式として書かない(USER_ENTERED注入対策)
const evilId = upsertCompany(db, { name: '数式注入テスト社' })
insertSelection(db, evilId, { company: '数式注入テスト社', season: '夏', position: '', priority: '', status: '=EVIL()', steps: [], nextAction: '+1234', nextDate: '', submitted: false, esUrl: '', memo: '=HYPERLINK("x")' })
const evilRow = renderMirror(db).filter((w) => w.tab.includes('選考管理')).flatMap((w) => w.values).find((r) => r[0] === '数式注入テスト社')!
check("codex反例: '=..'はアポストロフィで無害化", evilRow[4] === "'=EVIL()" && evilRow[14] === `'=HYPERLINK("x")`)
check("codex反例: '+..'も無害化・自前の残り日数の数式だけ生きる", evilRow[9] === "'+1234" && evilRow[11].startsWith('=ifs('))

if (failed) {
  console.error(`\n${failed}件失敗`)
  process.exit(1)
}
console.log('\nすべて通過 🎉')
