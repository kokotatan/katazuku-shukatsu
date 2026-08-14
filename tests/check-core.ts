/**
 * コア(src/db.ts のセマンティックレイヤー + src/db-apply.ts の日次反映)の動作チェック。
 * インメモリSQLiteで実行し、フィクスチャはすべて架空。実在の企業・人物は含まない。
 *   npm run test:core
 */
import { DatabaseSync } from 'node:sqlite'
import {
  openDb, upsertCompany, insertSelection, listSelections, listCompanies,
  transition, sameCompany, samePosition, resolveCompany, addAlias, listPending,
  setOfficialName, normalizeAppointmentAt, sameAppointment,
} from '../src/db'
import { applyDiff } from '../src/db-apply'
import { isMeetingUrl } from '../src/meeting-url'

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

// --- 名寄せ(エンティティ解決。架空企業) ---
check('株式会社の有無で同一企業に名寄せ', sameCompany('株式会社デルタ', 'デルタ'))
check('海外表記: Inc.の有無は同一視', sameCompany('Zephyr Inc.', 'Zephyr'))
check('海外表記: Co., Ltd. も吸収', sameCompany('Orion Co., Ltd.', 'Orion'))
const before = listCompanies(db).length
upsertCompany(db, { name: 'Ab' })
upsertCompany(db, { name: 'Abacus' })
check('短い名前(Ab≠Abacus)は別企業', listCompanies(db).length === before + 2)
upsertCompany(db, { name: 'アオイ・システムズ・プロ' })
upsertCompany(db, { name: 'アオイ' })
check('3文字の社名は完全一致のみ(アオイ≠アオイ・システムズ・プロ)', listCompanies(db).length === before + 4)

// --- samePosition(職種の包含判定) ---
check('長い職種名の包含を同一視', samePosition('アルゴリズム', 'アルゴリズムエンジニア サマーインターン'))
check('短い名称の包含は誤統合しない', !samePosition('AI', 'AIエンジニア'))
check('一般語でも完全一致なら同一トラック', samePosition('コンサル', 'コンサル'))

// --- 正式名称への昇格 ---
const nimbusId = upsertCompany(db, { name: 'Nimbus' })
setOfficialName(db, 'Nimbus', '株式会社Nimbus Technology')
check('正式名称が「正」(name)・通称はshortNameに残る',
  listCompanies(db).some((c) => c.name === '株式会社Nimbus Technology' && c.shortName === 'Nimbus'))
check('正式名称の英語表記(Inc.付き)でも確定できる',
  resolveCompany(db, 'Nimbus Technology, Inc.').companyId === nimbusId)

// --- applyDiff(日次反映。架空企業) ---
const omegaId = upsertCompany(db, { name: 'オメガ電機' })
insertSelection(db, omegaId, { company: 'オメガ電機', season: '夏', position: '', priority: '', status: '合格', steps: [], nextAction: '', nextDate: '', submitted: false, esUrl: '', memo: '' })
const res = applyDiff(db, [
  { name: 'オメガ電機', stage: 'closed' },
  { name: '新規テスト社', stage: 'task', nextAction: 'ES提出', nextDate: '2026-07-25', season: '夏' },
])
const sels = listSelections(db)
check('apply: 合格→辞退に確定', sels.find((s) => s.company === 'オメガ電機')!.status === '辞退')
check('apply: 新規企業はトラックごと追加される',
  sels.find((s) => s.company === '新規テスト社')?.status === '出願済')
check('apply: 結果集計(更新1/追加1)', res.updated.length === 1 && res.added.length === 1)

// --- 怪しい名寄せは書かず要確認に積み、alias学習後に確定する(架空企業) ---
upsertCompany(db, { name: 'コスモス' })
check('部分一致どまりは「怪しい」(自動マージしない)', resolveCompany(db, 'コスモス（Cosmos）').kind === 'suspicious')
const resPend = applyDiff(db, [{ name: 'コスモス（Cosmos）', stage: 'entried' }])
check('apply: 怪しい名寄せはDBに書かず要確認に積む',
  resPend.pending.length === 1 && listPending(db).some((p) => p.name === 'コスモス（Cosmos）'))
addAlias(db, 'コスモス（Cosmos）', 'コスモス')
check('alias学習後は確定になる', resolveCompany(db, 'コスモス（Cosmos）').kind === 'hit')

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
