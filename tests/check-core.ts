/**
 * コア(src/db.ts のセマンティックレイヤー + src/db-apply.ts の日次反映)の動作チェック。
 * インメモリSQLiteで実行。フィクスチャは実在名ではなく、規則を試すための合成ラベル(会社A/Example 等)。
 *   npm run test:core
 */
import { DatabaseSync } from 'node:sqlite'
import {
  openDb, upsertCompany, insertSelection, listSelections, listCompanies,
  transition, sameCompany, samePosition, resolveCompany, addAlias, listPending,
  setOfficialName, normalizeAppointmentAt, sameAppointment,
} from '../src/db.js'
import { applyDiff } from '../src/db-apply.js'
import { isMeetingUrl } from '../src/meeting-url.js'

let failed = 0
function check(label: string, cond: boolean, detail = '') {
  console.log(`${cond ? '[ok]' : '[FAIL]'} ${label}${cond ? '' : ` — ${detail}`}`)
  if (!cond) failed++
}

const db: DatabaseSync = openDb(':memory:')

// --- transition(状態遷移規則) ---
check('合格でも辞退の根拠があれば確定する', transition('合格', 'closed') === '辞退')
check('終了済(不合格)は復活させない', transition('不合格', 'intern') === null)
check('終了済(辞退)は動かさない', transition('辞退', 'entried') === null)
check('詳しい手書きステータスを粗い「出願済」で潰さない', transition('人事面接済(7/16)', 'entried') === null)
check('進行中の手書きに合格の根拠→確定に進める', transition('人事面接済(7/16)', 'intern') === '合格')
check('空欄→出願済を書く', transition('', 'entried') === '出願済')
check('「辞退予定」は本人意思なので内定通知でも上書きしない', transition('合格→本人辞退予定', 'offer') === null)
check('不合格メールは「辞退」でなく「不合格」と書く', transition('選考中', 'rejected') === '不合格')
check('同値は書かない', transition('出願済', 'entried') === null)

// --- 名寄せ(エンティティ解決)。名前は規則を試すための合成ラベル ---
check('株式会社の有無で同一企業に名寄せ', sameCompany('株式会社サンプル', 'サンプル'))
check('海外表記: Inc.の有無は同一視', sameCompany('Example Inc.', 'Example'))
check('海外表記: Co., Ltd. も吸収', sameCompany('Sample Co., Ltd.', 'Sample'))
const before = listCompanies(db).length
upsertCompany(db, { name: 'Ab' })
upsertCompany(db, { name: 'Abacus' })
check('短い名前(Ab≠Abacus)は別企業', listCompanies(db).length === before + 2)
upsertCompany(db, { name: 'AAA Systems' })
upsertCompany(db, { name: 'AAA' })
check('3文字の社名は完全一致のみ(AAA≠AAA Systems)', listCompanies(db).length === before + 4)

// --- samePosition(職種の包含判定) ---
check('長い職種名の包含を同一視', samePosition('アルゴリズム', 'アルゴリズムエンジニア サマーインターン'))
check('短い名称の包含は誤統合しない', !samePosition('AI', 'AIエンジニア'))
check('一般語でも完全一致なら同一トラック', samePosition('コンサル', 'コンサル'))

// --- 正式名称への昇格 ---
const officialId = upsertCompany(db, { name: 'Example' })
setOfficialName(db, 'Example', '株式会社Example Technology')
check('正式名称が「正」(name)・通称はshortNameに残る',
  listCompanies(db).some((c) => c.name === '株式会社Example Technology' && c.shortName === 'Example'))
// 「株式会社X」と「X, Inc.」は法人格が食い違う(日本法人と海外法人でありうる)。
// 芯が一致しても自動マージせず、1回だけ本人確認を挟んでから学習する。
const officialResolved = resolveCompany(db, 'Example Technology, Inc.')
check('法人格が食い違う同名は自動マージせず要確認へ回す',
  officialResolved.kind === 'suspicious' && officialResolved.suggestId === officialId)
addAlias(db, 'Example Technology, Inc.', '株式会社Example Technology')
const officialLearned = resolveCompany(db, 'Example Technology, Inc.')
check('確認して学習すれば以後は確定する',
  officialLearned.kind === 'hit' && officialLearned.companyId === officialId)

// --- 法人格の扱い(issue #7 回帰) ---
const kk = upsertCompany(db, { name: 'Torch K.K.' })
const torchCorp = resolveCompany(db, 'Torch Corp')
check('#7: K.K. と Corp は接尾辞除去で衝突しても別法人として要確認',
  torchCorp.kind === 'suspicious' && torchCorp.suggestId === kk)
const gk = upsertCompany(db, { name: '合同会社ハーバー' })
const kkHarbor = resolveCompany(db, '株式会社ハーバー')
check('#7: 合同会社と株式会社は別法人として要確認',
  kkHarbor.kind === 'suspicious' && kkHarbor.suggestId === gk)
check('#7: 要確認で作られた別法人は要確認リストに載る',
  (upsertCompany(db, { name: '株式会社ハーバー' }) > 0) && listPending(db).some((p) => p.name === '株式会社ハーバー'))

const plain = upsertCompany(db, { name: 'Lantern' })
check('無印と法人格付きは同一(片方が無印なら矛盾しない)',
  (resolveCompany(db, 'Lantern Inc.') as { kind: string; companyId?: number }).companyId === plain)
const coLtd = upsertCompany(db, { name: 'Beacon Co., Ltd.' })
check('Co.,Ltd. と Ltd. は部分集合なので同一',
  (resolveCompany(db, 'Beacon Ltd.') as { kind: string; companyId?: number }).companyId === coLtd)

// holdings / company はトレードネームの一部。法人格として落としてはいけない
upsertCompany(db, { name: 'Cascade' })
check('#7: 「X Holdings」を「X」へ自動マージしない',
  resolveCompany(db, 'Cascade Holdings').kind === 'suspicious')
check('#7: normalize は holdings を落とさない', !sameCompany('Cascade Holdings', 'Cascade Group'))

// 名前が法人格だけ、というデータ事故で全社が1社に潰れないこと
const onlyDesignator = listCompanies(db).length
upsertCompany(db, { name: '株式会社' })
upsertCompany(db, { name: '合同会社' })
check('芯が空(法人格だけ)の名前どうしを同一視しない', listCompanies(db).length === onlyDesignator + 2)

// --- applyDiff(日次反映) ---
const companyX = upsertCompany(db, { name: '会社X' })
insertSelection(db, companyX, { company: '会社X', season: '夏', position: '', priority: '', status: '合格', steps: [], nextAction: '', nextDate: '', submitted: false, esUrl: '', memo: '' })
const res = applyDiff(db, [
  { name: '会社X', stage: 'closed' },
  { name: '会社Y', stage: 'task', nextAction: 'ES提出', nextDate: '2026-07-25', season: '夏' },
])
const sels = listSelections(db)
check('apply: 合格→辞退に確定', sels.find((s) => s.company === '会社X')!.status === '辞退')
check('apply: 新規企業はトラックごと追加される', sels.find((s) => s.company === '会社Y')?.status === '出願済')
check('apply: 結果集計(更新1/追加1)', res.updated.length === 1 && res.added.length === 1)

// --- 怪しい名寄せは書かず要確認に積み、alias学習後に確定する ---
upsertCompany(db, { name: 'サンプル社' })
check('部分一致どまりは「怪しい」(自動マージしない)', resolveCompany(db, 'サンプル社（Sample）').kind === 'suspicious')
const resPend = applyDiff(db, [{ name: 'サンプル社（Sample）', stage: 'entried' }])
check('apply: 怪しい名寄せはDBに書かず要確認に積む',
  resPend.pending.length === 1 && listPending(db).some((p) => p.name === 'サンプル社（Sample）'))
addAlias(db, 'サンプル社（Sample）', 'サンプル社')
check('alias学習後は確定になる', resolveCompany(db, 'サンプル社（Sample）').kind === 'hit')

// --- appointment 突合(重複予定の防止) ---
check('at正規化: TZ無しは日本時間として同じ瞬間に揃う',
  normalizeAppointmentAt('2026-07-24T14:00') === normalizeAppointmentAt('2026-07-24T14:00:00+09:00'))
check('sameAppointment: 時刻が空の予定は突合しない',
  !sameAppointment({ at: '', title: 'X' }, { at: '', title: 'X' }))
check('sameAppointment: 同時刻でもURLが両方あって別なら別会議',
  !sameAppointment(
    { at: '2026-08-20T14:00', title: 'A', url: 'https://meet.google.com/aaa', kind: '面談' },
    { at: '2026-08-20T14:00', title: 'B', url: 'https://meet.google.com/bbb', kind: '面談' }))

// --- 会議URL許可リスト ---
check('meeting-url: Meet直リンクは会議URL', isMeetingUrl('https://meet.google.com/ibr-kvcs-ffn'))
check('meeting-url: Zoomサブドメインも会議URL', isMeetingUrl('https://us05web.zoom.us/j/123'))
check('meeting-url: 短縮リンクも受理', isMeetingUrl('https://bit.ly/abc'))
check('meeting-url: 無関係URL・空・不正は非会議',
  !isMeetingUrl('https://example.com/x') && !isMeetingUrl('') && !isMeetingUrl(null))
check('meeting-url: 偽装ホスト(weburl.jp.evil.com)は受理しない', !isMeetingUrl('https://weburl.jp.evil.com/x'))

if (failed) { console.error(`\n${failed}件失敗`); process.exit(1) }
console.log('\nすべて通過')
