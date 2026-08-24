/**
 * 正本DB(src/db.ts)と日次反映(db-apply)・ミラー(db-mirror)の動作チェック。
 * インメモリSQLiteで実行。実行: cd sync && npx tsx scripts/check-db.ts
 */
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, upsertCompany, insertSelection, listSelections, listCompanies, listEvents, listAppointments, addAppointment, listAppointmentConflicts, outcomeOf, transition, sameCompany, samePosition, resolveCompany, addAlias, listPending, setOfficialName, normalizeAppointmentAt, sameAppointment, getDatabaseContext, SCHEMA_VERSION } from '../src/db'
import { applyDiff } from './db-apply'
import { savePersonPhoto } from './db-apply-interview'
import { applyCalendar } from './db-apply-calendar'
import { findDuplicates } from './check-duplicate-appointments'
import { renderMirror, PASSWORD_MASK } from './db-mirror'
import { listPlatformSnapshot } from '../src/platform'
import { transaction, upsertPerson } from '../src/inputs'
import { isMeetingUrl } from '../src/meeting-url'
import { applyScheduleProjection, getScheduleAvailability } from '../src/schedule'
import { resolveDatabasePath } from '../src/database-path'

let failed = 0
function check(label: string, cond: boolean, detail = '') {
  console.log(`${cond ? '✅' : '❌'} ${label}${cond ? '' : ` — ${detail}`}`)
  if (!cond) failed++
}

// openDbは:memory:でも動く(mkdirはdirname='.'で無害)
const db: DatabaseSync = openDb(':memory:')

// --- スキーマ版(2026-07-22。破壊的マイグレーションを番号で束ねる土台) ---
const uv = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
check('openDbが現行スキーマ版をuser_versionへ記録する', uv === SCHEMA_VERSION, `user_version=${uv}`)
const memoryContext = getDatabaseContext(db)
check('DB identity: インメモリDBをfixtureとして識別する', memoryContext.role === 'fixture' && memoryContext.path === ':memory:')
check('DB identity: 同じDBを開いている間は論理IDが安定する', memoryContext.databaseId === getDatabaseContext(db).databaseId)
check('DB path: KATAZUKU_DBを旧KATAZUKU_DB_PATHより優先する',
  resolveDatabasePath(undefined, { env: { KATAZUKU_DB: './canonical.db', KATAZUKU_DB_PATH: './legacy.db' } })
    .endsWith('canonical.db'))
check('DB path: 明示引数を環境変数より優先する',
  resolveDatabasePath('./explicit.db', { env: { KATAZUKU_DB: './canonical.db' } }).endsWith('explicit.db'))

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
check('#5: 内定は不合格で自動的に潰さない(誤割当保護)', transition('内定', 'rejected') === null)
check('#5: 内定辞退(closed)は本人意思なので確定できる', transition('内定', 'closed') === '辞退')
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
check('samePosition: 長い職種名の包含を同一視', samePosition('アルゴリズム', 'アルゴリズムエンジニア サマーインターン'))
check('samePosition: 短い名称の包含は誤統合しない', !samePosition('AI', 'AIエンジニア'))
check('samePosition: 一般語だけの職種は包含一致で誤統合しない',
  !samePosition('コンサル', 'Autumn Internship(ビジネスコンサルタント職)') && !samePosition('エンジニア', 'ソフトウェアエンジニア(夏)'))
check('samePosition: 一般語でも完全一致なら同一トラック', samePosition('コンサル', 'コンサル'))

// --- 正式名称(株式会社/海外表記対応。2026-07-18本人指示) ---
check('海外表記: Inc.の有無は同一視', sameCompany('Mujin Inc.', 'Mujin'))
check('海外表記: Co., Ltd. も吸収', sameCompany('Sansan Co., Ltd.', 'Sansan'))
const pkTestId = upsertCompany(db, { name: 'PKSHA' })
setOfficialName(db, 'PKSHA', '株式会社PKSHA Technology')
check('正式名称が「正」(name)になる', listCompanies(db).some((c) => c.name === '株式会社PKSHA Technology' && c.shortName === 'PKSHA'))
check('正式名称(株式会社付き)で確定できる', resolveCompany(db, '株式会社PKSHA Technology').kind === 'hit')
const rOfficial = resolveCompany(db, 'PKSHA Technology, Inc.')
// 日本語法人格(株式会社)と英語法人格(Inc.)は基幹名が同じでも別法人でありうる。
// 自動マージせず要確認にして、本人確認→aliasで学習する(別法人の混線を防ぐ)。
check('日本語と英語で法人格が違う表記は自動マージせず要確認にする', rOfficial.kind === 'suspicious' && rOfficial.suggestId === pkTestId)
check('学習(alias)後は英語法人格表記でも確定できる', (() => { addAlias(db, 'PKSHA Technology, Inc.', '株式会社PKSHA Technology'); return resolveCompany(db, 'PKSHA Technology, Inc.').kind === 'hit' })())
check('昇格後も通称(PKSHA)で確定できる', resolveCompany(db, 'PKSHA').kind === 'hit')

// #3回帰: 基幹名が同じでも法人格が異なる別法人は自動マージしない(データ破壊防止)
upsertCompany(db, { name: 'AB Inc.' })
check('別法人格(AB Inc. と AB Ltd.)は無確認マージせず要確認', resolveCompany(db, 'AB Ltd.').kind === 'suspicious')
// 同一企業の 正式名称↔通称(法人格なし)は従来どおり確定する
upsertCompany(db, { name: '株式会社ダミー精機' })
check('正式名称↔通称(法人格なし)は同一で確定する', resolveCompany(db, 'ダミー精機').kind === 'hit')

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
insertSelection(db, sansanId, { company: 'Sansan', season: '夏', position: '3days', priority: '', status: '参加確定 7/19-22', steps: [], nextAction: '', nextDate: '', submitted: false, esUrl: '', memo: '' })
const res2 = applyDiff(db, [{ name: 'Sansan', stage: 'intern', position: '1day', season: '夏' }])
const sansans = listSelections(db).filter((s) => s.company === 'Sansan')
check('codex反例: position不一致は既存トラックを書き換えない', sansans.find((s) => s.position === '3days')?.status === '参加確定 7/19-22')
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
check('mirror: 企業タブは7列で全社ぶん', coAll[0].length === 7 && coAll.slice(1).filter((r) => r[0]).length === listCompanies(db).length)
check('mirror: A列が正式名称・B列が通称', coAll[0][0] === '正式名称' && coAll[0][1] === '通称' && coAll.some((r) => r[0] === '株式会社PKSHA Technology' && r[1] === 'PKSHA'))
check('mirror: 選考管理タブの表示は通称のまま', selAll.some((r) => r[0] === '八洲電機'))

// パスワードの実値はDBの外へ出さない(2026-07-20。実値はDBとspec13ブローカーのみ)
upsertCompany(db, { name: '秘密境界テスト社', password: 'raw-secret-pw-123' })
const pwWrites = renderMirror(db)
const pwFlat = pwWrites.flatMap((w) => w.values.flat())
check('mirror: パスワード実値がどこにも出ない', !pwFlat.some((v) => v.includes('raw-secret-pw-123')))
const pwCo = pwWrites.filter((w) => w.tab.includes('企業マスタ')).flatMap((w) => w.values)
check('mirror: 設定済パスワードは保護マークに置換', pwCo.find((r) => r[0] === '秘密境界テスト社')?.[5] === PASSWORD_MASK)
check('mirror: 未設定パスワードは空欄のまま', pwCo.find((r) => r[0] === '株式会社PKSHA Technology')?.[5] === '')

// codex反例: データ由来の「=」始まりを数式として書かない(USER_ENTERED注入対策)
const evilId = upsertCompany(db, { name: '数式注入テスト社' })
insertSelection(db, evilId, { company: '数式注入テスト社', season: '夏', position: '', priority: '', status: '=EVIL()', steps: [], nextAction: '+1234', nextDate: '', submitted: false, esUrl: '', memo: '=HYPERLINK("x")' })
const evilRow = renderMirror(db).filter((w) => w.tab.includes('選考管理')).flatMap((w) => w.values).find((r) => r[0] === '数式注入テスト社')!
check("codex反例: '=..'はアポストロフィで無害化", evilRow[4] === "'=EVIL()" && evilRow[14] === `'=HYPERLINK("x")`)
check("codex反例: '+..'も無害化・自前の残り日数の数式だけ生きる", evilRow[9] === "'+1234" && evilRow[11].startsWith('=ifs('))

// --- outcome(機械判定の列挙。status自由文と分離) ---
check('outcome: 進行中の自由文', outcomeOf('人事面接済(7/16)') === '進行中')
check('outcome: 「合格→本人辞退予定」は辞退', outcomeOf('合格→本人辞退予定') === '辞退')
check('outcome: 不合格は合格に化けない', outcomeOf('不合格') === '不合格')
check('outcome: 参加確定は合格系', outcomeOf('参加確定 8/19-21') === '合格')

// --- appointment(予定。時刻・URL・場所・相手まで構造化して持つ) ---
const apSel = listSelections(db).find((s) => s.company === 'PKSHA' && s.position === 'アルゴリズム')!
const ap1 = addAppointment(db, { selectionId: apSel.id, at: '2026-07-21T23:59', kind: '締切', title: '研究資料PDF提出' })
check('appointment: 新規作成', ap1.created)
const ap2 = addAppointment(db, { selectionId: apSel.id, at: '2026-07-21T23:59', kind: '締切', title: '研究資料PDF提出', url: 'https://example.com/submit' })
check('appointment: 同一(トラック×日時×タイトル)は重複しない', !ap2.created && ap2.id === ap1.id)
check('appointment: 空欄のURLは後から補完される', listAppointments(db).some((a) => a.title === '研究資料PDF提出' && a.url === 'https://example.com/submit'))

const allDay = addAppointment(db, {
  selectionId: apSel.id,
  at: '2026-09-02T00:00:00+09:00',
  endAt: '2026-09-05T00:00:00+09:00',
  kind: 'インターン',
  title: '3daysインターン',
})
check('appointment: start/endを同じUTC形式で保存する',
  listAppointments(db).find((a) => a.id === allDay.id)?.endAt === normalizeAppointmentAt('2026-09-05T00:00:00+09:00'))
check('予定衝突: 複数日の終日予定の途中を検出する',
  listAppointmentConflicts(db, '2026-09-04T18:00:00+09:00', '2026-09-04T18:30:00+09:00').some((a) => a.id === allDay.id))
check('予定衝突: 終了境界直後は空きとして扱う',
  !listAppointmentConflicts(db, '2026-09-05T00:00:00+09:00', '2026-09-05T00:30:00+09:00').some((a) => a.id === allDay.id))

// --- 空き判定セマンティック層(会社に属さない大学・私用予定も含み、同期不全はunknown) ---
const scheduleNow = '2026-10-01T00:00:00.000Z'
applyScheduleProjection(db, {
  blocks: [{
    provider: 'google-calendar', accountId: 'personal@example.com', calendarId: 'primary',
    externalId: 'private-block-1', title: '大学の予定',
    startAt: '2026-10-10T13:00:00+09:00', endAt: '2026-10-10T15:00:00+09:00',
  }],
  syncStates: [{
    source: 'google-calendar', accountId: 'personal@example.com', scopeId: 'primary', status: 'success',
    coveredFrom: '2026-09-24T00:00:00.000Z', coveredUntil: '2026-11-30T00:00:00.000Z', attemptedAt: scheduleNow,
  }],
  replaceSyncSources: true,
})
const privateConflict = getScheduleAvailability(
  db, '2026-10-10T14:00:00+09:00', '2026-10-10T14:30:00+09:00',
  { now: new Date(scheduleNow), requireCanonical: false },
)
check('schedule: 選考トラックに属さない私用・大学予定も衝突になる',
  privateConflict.state === 'conflict' && privateConflict.conflicts.some((item) => item.source === 'calendar'))
const freeSlot = getScheduleAvailability(
  db, '2026-10-10T16:00:00+09:00', '2026-10-10T16:30:00+09:00',
  { now: new Date(scheduleNow), requireCanonical: false },
)
check('schedule: 同期済み期間内で衝突なしの場合だけavailable', freeSlot.state === 'available' && freeSlot.available)
applyScheduleProjection(db, {
  syncStates: [{
    source: 'google-calendar', accountId: 'personal@example.com', scopeId: 'primary', status: 'failed',
    attemptedAt: '2026-10-01T00:05:00.000Z', error: 'test failure',
  }],
  replaceSyncSources: true,
})
const unknownSlot = getScheduleAvailability(
  db, '2026-10-10T16:00:00+09:00', '2026-10-10T16:30:00+09:00',
  { now: new Date('2026-10-01T00:05:00.000Z'), requireCanonical: false },
)
check('schedule: 最新Calendar同期が失敗なら空きへ丸めずunknown', !unknownSlot.available && unknownSlot.state === 'unknown')
const knownConflictWithFailedSync = getScheduleAvailability(
  db, '2026-10-10T14:00:00+09:00', '2026-10-10T14:30:00+09:00',
  { now: new Date('2026-10-01T00:05:00.000Z'), requireCanonical: false },
)
check('schedule: 同期不全でも既知の衝突があれば安全側のconflict', knownConflictWithFailedSync.state === 'conflict')

const apRes = applyDiff(db, [{ name: '予定テスト社', stage: 'interview', appointments: [{ at: '2026-07-25T15:00', kind: '面接', title: '2次面接', url: 'https://zoom.us/j/xxx', person: '川島氏' }] }])
check('apply: 予定つき新規はappointmentも入る', apRes.added.length === 1 && listAppointments(db).some((a) => a.title === '2次面接' && a.person === '川島氏'))
check('apply: 予定追加はイベントに残る', listEvents(db).some((e) => e.kind === '予定追加' && e.summary.includes('2次面接')))
const evBefore = listEvents(db).length
applyDiff(db, [{ name: '予定テスト社', stage: 'interview', appointments: [{ at: '2026-07-25T15:00', kind: '面接', title: '2次面接' }] }])
check('apply: 同じ予定の再適用でイベントは増えない', listEvents(db).length === evBefore)

// --- 重複予定の防止(2026-07-24の実害: 同じグッドパッチ面談がカレンダー由来とメール由来で2行になり、
//     meeting-autopilot が同じURLを二重に開き録音も二重起動しうる状態だった) ---
check('at正規化: TZ無しは日本時間として同じ瞬間に揃う', normalizeAppointmentAt('2026-07-24T14:00') === normalizeAppointmentAt('2026-07-24T14:00:00+09:00'))
check('at正規化: 日付のみは当日0時(JST)として扱う', normalizeAppointmentAt('2026-07-26') === normalizeAppointmentAt('2026-07-26T00:00:00+09:00'))
check('at正規化: 解釈できない文字列は元のまま', normalizeAppointmentAt('未定') === '未定')
check('sameAppointment: 解釈できない時刻は従来どおり文字列一致で突合', sameAppointment({ at: '未定', title: 'X' }, { at: '未定', title: 'X' }) && !sameAppointment({ at: '未定', title: 'X' }, { at: '未定です', title: 'X' }))
check('sameAppointment: 時刻が空の予定は突合しない(何とでも一致してしまうため)', !sameAppointment({ at: '', title: 'X' }, { at: '', title: 'X' }))
check('sameAppointment: 同時刻でもURLが両方あって別なら別会議',
  !sameAppointment({ at: '2026-08-20T14:00', title: 'A', url: 'https://meet.google.com/aaa', kind: '面談' }, { at: '2026-08-20T14:00', title: 'B', url: 'https://meet.google.com/bbb', kind: '面談' }))
check('sameAppointment: 締切は同時刻でも別タイトルなら別物(23:59に複数並ぶため)',
  !sameAppointment({ at: '2026-08-20T23:59', title: 'ES提出', url: 'https://example.com/es', kind: '締切' }, { at: '2026-08-20T23:59', title: '証明写真提出', kind: '締切' }))

const dupCoId = upsertCompany(db, { name: 'ダブり検証カンパニー' })
const MEET_A = 'https://meet.google.com/dup-aaa-bbb'
const MEET_B = 'https://meet.google.com/dup-ccc-ddd'
const rowsOf = (selectionId: number) => listAppointments(db).filter((a) => a.selectionId === selectionId)

// 1) メール由来が先 → 後からカレンダー由来が来ても新規作成せず、その行へexternal_idを埋めて昇格する
const dupSel1 = insertSelection(db, dupCoId, { company: 'ダブり検証カンパニー', season: '本選考', position: 'デザイナー', priority: '', status: '選考中', steps: [], nextAction: '', nextDate: '', submitted: false, esUrl: '', memo: '' })
addAppointment(db, { selectionId: dupSel1, at: '2026-08-20T14:00', kind: '面談', title: 'カジュアル面談(内田様)', url: MEET_A, person: '内田様(調整:渡辺様)' })
const calAfterMail = applyCalendar({
  events: [{
    externalId: 'dup-ext-1', calendarId: 'cal@example.com', title: 'カジュアル面談(内田さん)',
    startAt: '2026-08-20T14:00:00+09:00', endAt: '2026-08-20T15:00:00+09:00',
    company: 'ダブり検証カンパニー', position: 'デザイナー', kind: '面談', url: MEET_A,
    attendees: [{ name: '内田 啓太' }],
  }],
}, db)
const merged1 = rowsOf(dupSel1)
check('重複防止: メール由来→カレンダー由来でも1行に収束する', merged1.length === 1, `${merged1.length}行`)
check('重複防止: 昇格でcreatedは増えずpromotedになる', calAfterMail.created === 0 && calAfterMail.promoted === 1)
const promotedRow = db.prepare('SELECT external_id, calendar_id, title, end_at FROM appointment WHERE selection_id = ?').get(dupSel1) as { external_id: string; calendar_id: string; title: string; end_at: string }
check('重複防止: 昇格した行にexternal_id/calendar_idが入る', promotedRow.external_id === 'dup-ext-1' && promotedRow.calendar_id === 'cal@example.com')
check('重複防止: タイトル・終了時刻はカレンダーが正', promotedRow.title === 'カジュアル面談(内田さん)' && promotedRow.end_at === '2026-08-20T15:00:00+09:00')
check('重複防止: 統合はイベント台帳に根拠として残る', listEvents(db).some((e) => e.kind === '予定統合' && e.summary.includes('内田様(調整:渡辺様)')))

// 2) カレンダー由来が先 → 後からメール由来が来ても新規作成しない
const dupSel2 = insertSelection(db, dupCoId, { company: 'ダブり検証カンパニー', season: '本選考', position: 'エンジニア', priority: '', status: '選考中', steps: [], nextAction: '', nextDate: '', submitted: false, esUrl: '', memo: '' })
applyCalendar({
  events: [{
    externalId: 'dup-ext-2', calendarId: 'cal@example.com', title: '2次面接',
    startAt: '2026-08-21T10:00:00+09:00', endAt: '2026-08-21T11:00:00+09:00',
    company: 'ダブり検証カンパニー', position: 'エンジニア', kind: '面接', url: MEET_B,
  }],
}, db)
const mailAfterCal = addAppointment(db, { selectionId: dupSel2, at: '2026-08-21T10:00', kind: '面接', title: '2次面接(佐藤様)', url: MEET_B, person: '佐藤様' })
check('重複防止: カレンダー由来→メール由来でも1行に収束する', rowsOf(dupSel2).length === 1 && !mailAfterCal.created)
check('重複防止: メール由来は空欄だけ補完する(カレンダーの値は壊さない)', rowsOf(dupSel2)[0].person === '佐藤様' && rowsOf(dupSel2)[0].title === '2次面接')

// 3) 別会議は別行のまま(時刻違い・URL違い)
addAppointment(db, { selectionId: dupSel2, at: '2026-08-21T11:30', kind: '面接', title: '3次面接', url: MEET_B })
check('重複防止: 時刻が違えば同じURLでも別行', rowsOf(dupSel2).length === 2)
addAppointment(db, { selectionId: dupSel2, at: '2026-08-21T10:00', kind: '面接', title: '別部署の面接', url: 'https://meet.google.com/dup-eee-fff' })
check('重複防止: 同時刻でもURLが違えば別行', rowsOf(dupSel2).length === 3)

// 4) 点検スクリプト: 現行の突合規則で同一になる組を「確定」として拾える
db.prepare(`
  INSERT INTO appointment (selection_id, at, end_at, kind, title, url, location, person, status, created_at, external_id, calendar_id, source_hash)
  VALUES (?, '2026-08-20T14:00:00+09:00', '', '面談', 'カジュアル面談(内田様)', ?, '', '内田様', '予定', '2026-07-19T23:45:14.071Z', '', '', '')
`).run(dupSel1, MEET_A)
const calendarRowId = (db.prepare("SELECT id FROM appointment WHERE external_id = 'dup-ext-1'").get() as { id: number }).id
const dupPairs = findDuplicates(db).filter((p) => p.company === 'ダブり検証カンパニー')
const confirmed = dupPairs.filter((p) => p.confidence === '確定')
check('点検: 同一トラック・同一時刻・同一URLの組を確定として検出', confirmed.length === 1 && confirmed[0].reason.includes('同一URL'))
check('点検: カレンダー由来(external_idあり)を残す側に選ぶ', confirmed[0]?.keepId === calendarRowId && confirmed[0]?.dropId !== calendarRowId)
check('点検: 別会議(URL違い・時刻違い)は確定重複にしない', !confirmed.some((p) => p.dropId !== confirmed[0].dropId))


// --- トラック重複防止 ---
const blankCompanyId = upsertCompany(db, { name: '空トラックテスト社' })
insertSelection(db, blankCompanyId, { company: '空トラックテスト社', season: '', position: '', priority: '', status: '出願済', steps: [], nextAction: '', nextDate: '', submitted: false, esUrl: '', memo: '' })
applyDiff(db, [{ name: '空トラックテスト社', position: 'データサイエンティスト', stage: 'interview' }])
const promotedTracks = listSelections(db).filter((selection) => selection.company === '空トラックテスト社')
check('track: 既存1本がposition空欄なら具体名へ昇格して重複しない', promotedTracks.length === 1 && promotedTracks[0].position === 'データサイエンティスト')

// --- 6入力の共通DB基盤 ---
const appointmentColumns = (db.prepare('PRAGMA table_info(appointment)').all() as { name: string }[]).map((column) => column.name)
check('calendar: external_id/end_at/source_hashを保持', ['external_id', 'end_at', 'source_hash'].every((name) => appointmentColumns.includes(name)))

const personId1 = upsertPerson(db, { name: '面接 テスト', company: '予定テスト社', role: '採用担当' })
const personId2 = upsertPerson(db, { name: '面接 テスト', company: '予定テスト社', role: '別表記' })
check('people: 同じ氏名×会社は重複しない', personId1 === personId2)
const personId3 = upsertPerson(db, { name: '面接テストさん', company: '株式会社予定テスト社' })
check('people: 敬称・空白・社名表記の違いでも同一人物に名寄せする', personId3 === personId1)
const personId4 = upsertPerson(db, { name: '面接 テスト太郎', company: '予定テスト社' })
check('people: 姓だけ登録済みでもフルネームを同一人物に名寄せし名前を昇格する',
  personId4 === personId1
  && (db.prepare('SELECT name FROM person WHERE id = ?').get(personId1) as { name: string }).name === '面接 テスト太郎')
const personId5 = upsertPerson(db, { name: '別人 サンプル', company: '予定テスト社' })
check('people: 別名の人物は新規作成する', personId5 !== personId1)
db.prepare("INSERT INTO person_note (person_id, at, note, source_ref, confidence) VALUES (?, '2026-07-18', '顧客志向を重視', 'test-run', 0.9)")
  .run(personId1)
db.prepare("INSERT INTO person_photo (person_id, storage_key, sha256, verified_at) VALUES (?, 'people/test.jpg', 'abc', '2026-07-18')")
  .run(personId1)

// --- 面談スクショからの顔写真登録(db-apply-interview.savePersonPhoto) ---
const photoRoot = mkdtempSync(join(tmpdir(), 'katazuku-photo-'))
const facePng = join(photoRoot, 'face-1.png')
writeFileSync(facePng, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
const photoPersonId = upsertPerson(db, { name: '写真 テスト', company: '予定テスト社' })
const savedKey = savePersonPhoto(db, photoPersonId, facePng, photoRoot)
check('photo: storage_keyだけをDBへ記録し実体はphotos配下へ複製する',
  savedKey === `people/person-${photoPersonId}.png`
  && existsSync(join(photoRoot, savedKey))
  && !!db.prepare('SELECT 1 FROM person_photo WHERE person_id = ? AND storage_key = ?').get(photoPersonId, savedKey))
check('photo: 既に写真がある人物は上書きしない', savePersonPhoto(db, photoPersonId, facePng, photoRoot) === '')
let photoExtError = ''
try { savePersonPhoto(db, photoPersonId, join(photoRoot, 'x.gif'), photoRoot) } catch (e) { photoExtError = (e as Error).message }
check('photo: 未対応の画像形式は拒否する', photoExtError.includes('未対応'))
rmSync(photoRoot, { recursive: true, force: true })

transaction(db, () => {
  db.prepare("INSERT INTO profile_basic (id, data_json, updated_at, updated_by) VALUES (1, ?, '2026-07-18', 'test')")
    .run(JSON.stringify({ name: 'テスト', photo: 'data:image/jpeg;base64,SECRET', photoKey: 'profile/basic.jpg' }))
  db.prepare("INSERT INTO profile_suggestion (field, value, source_ref, confidence, status, created_at) VALUES ('strengths', '改善力', 'test-run', 0.8, '候補', '2026-07-18')")
    .run()
})
const platformSnapshot = listPlatformSnapshot(db)
const profileJson = JSON.stringify(platformSnapshot.profile)
check('profile: 画像本体をsnapshotへ出さない', !profileJson.includes('data:image') && profileJson.includes('profile/basic.jpg'))
check('people: 写真はstorage keyだけをsnapshotへ出す', platformSnapshot.people.some((person) => person.photoKey === 'people/test.jpg'))
check('interview: 人物メモとプロフィール候補は根拠付き', platformSnapshot.personNotes.some((note) => note.sourceRef === 'test-run') && platformSnapshot.profileSuggestions.some((suggestion) => suggestion.sourceRef === 'test-run'))

// --- 会議URL許可リスト(直リンク + 短縮リンク。会議自動運転が開いて録る対象の判定) ---
check('meeting-url: Meet直リンクは会議URL', isMeetingUrl('https://meet.google.com/ibr-kvcs-ffn'))
check('meeting-url: Zoomサブドメインも会議URL', isMeetingUrl('https://us05web.zoom.us/j/123'))
check('meeting-url: Teams直リンクは会議URL', isMeetingUrl('https://teams.microsoft.com/l/meetup-join/xxx'))
check('meeting-url: weburl.jp短縮リンクを会議URLとして受理', isMeetingUrl('https://weburl.jp/sE8jDmR'))
check('meeting-url: bit.ly等の短縮リンクも受理', isMeetingUrl('https://bit.ly/abc') && isMeetingUrl('https://tinyurl.com/abc') && isMeetingUrl('https://t.co/abc'))
check('meeting-url: www.付き短縮リンクも受理', isMeetingUrl('https://www.cutt.ly/abc'))
check('meeting-url: 無関係URL・空・不正は非会議', !isMeetingUrl('https://example.com/x') && !isMeetingUrl('') && !isMeetingUrl('not a url') && !isMeetingUrl(null))
check('meeting-url: 偽装ホスト(weburl.jp.evil.com)は受理しない', !isMeetingUrl('https://weburl.jp.evil.com/x'))

const requiredTables = ['meeting_run', 'interview_note', 'submission', 'company_dossier', 'mail_item', 'appointment_person', 'database_identity', 'source_sync_state', 'schedule_block']
const schemaTables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((row) => row.name)
check('6入力: 必要な専用テーブルが揃う', requiredTables.every((name) => schemaTables.includes(name)))

if (failed) {
  console.error(`\n${failed}件失敗`)
  process.exit(1)
}
console.log('\nすべて通過 🎉')
