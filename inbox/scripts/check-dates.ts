/**
 * 締切抽出(lib/dates.ts)の動作チェック。
 * 実行: cd inbox && npx tsx scripts/check-dates.ts
 */
import {
  extractDates,
  pickDeadline,
  urgencyOf,
  formatRemaining,
  formatDateShort,
} from '../src/lib/dates'

let failed = 0
function check(label: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'OK' : 'NG'} ${label}${cond ? '' : ` — ${detail}`}`)
  if (!cond) failed++
}

function fmt(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function sameMoment(d: Date, y: number, mo: number, day: number, h: number, mi: number): boolean {
  return d.getTime() === new Date(y, mo - 1, day, h, mi).getTime()
}

// 基準日: 2026-07-10(金) ※テストは固定日で決定的に動かす
const BASE = new Date(2026, 6, 10, 15, 0)

// ---------------------------------------------------------------
// 1. 基本の日付抽出
// ---------------------------------------------------------------
let ds = extractDates('提出期限は2026/7/25です', BASE)
check('YYYY/MM/DD形式を抽出', ds.length === 1, `件数=${ds.length}`)
check(
  '時刻なしは23:59扱い',
  ds.length === 1 && sameMoment(ds[0].date, 2026, 7, 25, 23, 59),
  ds[0] ? fmt(ds[0].date) : 'なし',
)
check('時刻なしは hasTime=false', ds.length === 1 && !ds[0].hasTime)

ds = extractDates('2026年8月1日に開催します', BASE)
check(
  'YYYY年M月D日形式を抽出',
  ds.length === 1 && sameMoment(ds[0].date, 2026, 8, 1, 23, 59),
  ds[0] ? fmt(ds[0].date) : 'なし',
)

ds = extractDates('次回は8月1日です', BASE)
check(
  '年省略は基準年で補完',
  ds.length === 1 && ds[0].date.getFullYear() === 2026,
  ds[0] ? fmt(ds[0].date) : 'なし',
)

ds = extractDates('会期: 8/1〜8/3、ぜひご来場ください', BASE)
check('日付範囲は両端とも抽出', ds.length === 2, `件数=${ds.length}`)

ds = extractDates('13月1日は存在しない日付です', BASE)
check('不正な月(13月)は抽出しない', ds.length === 0, `件数=${ds.length}`)

check(
  '日付が無い本文は空配列',
  extractDates('新しいオフィスに移転しました。今後ともよろしくお願いいたします。', BASE).length === 0,
)

// ---------------------------------------------------------------
// 2. 年省略時の翌年補正(過去60日超は翌年)の境界
//    基準 2026-07-10 00:00 のとき、境界はちょうど 2026-05-11 00:00
// ---------------------------------------------------------------
const BASE_MIDNIGHT = new Date(2026, 6, 10, 0, 0)

ds = extractDates('5月11日に説明会を実施しました', BASE_MIDNIGHT)
check(
  'ちょうど60日前(5/11)は当年のまま',
  ds.length === 1 && ds[0].date.getFullYear() === 2026,
  ds[0] ? fmt(ds[0].date) : 'なし',
)

ds = extractDates('5月10日に説明会を実施しました', BASE_MIDNIGHT)
check(
  '60日超過去(5/10)は翌年に補正',
  ds.length === 1 && ds[0].date.getFullYear() === 2027,
  ds[0] ? fmt(ds[0].date) : 'なし',
)

ds = extractDates('2025年12月1日に開催しました', BASE_MIDNIGHT)
check(
  '年が明記された過去日は補正しない',
  ds.length === 1 && ds[0].date.getFullYear() === 2025,
  ds[0] ? fmt(ds[0].date) : 'なし',
)

// ---------------------------------------------------------------
// 3. 締切文脈と単なる予定の区別
// ---------------------------------------------------------------
ds = extractDates('7月20日までにご提出ください', BASE)
check('「まで」+「提出」は締切扱い', ds.length === 1 && ds[0].isDeadline)

ds = extractDates('説明会を7月20日に開催します', BASE)
check('開催告知は締切扱いにしない', ds.length === 1 && !ds[0].isDeadline)

ds = extractDates('提出期限は【7/29 12:00】のため厳守ください', BASE)
check('締切語が日付の前にあっても検出', ds.length === 1 && ds[0].isDeadline)

ds = extractDates(
  '一次面接は7月15日に実施します。なお、参加可否のご連絡は7月13日までにお願いします。',
  BASE,
)
check('予定と締切が混在: 2件抽出', ds.length === 2, `件数=${ds.length}`)
check('混在時: 予定(7/15)は締切扱いでない', ds.length === 2 && !ds[0].isDeadline)
check('混在時: 締切(7/13)だけ締切扱い', ds.length === 2 && ds[1].isDeadline)

// ---------------------------------------------------------------
// 4. pickDeadline の選抜規則
// ---------------------------------------------------------------
// 未来の締切 > 未来の予定(予定のほうが日付が近くても締切を選ぶ)
let text = 'セミナーは7月12日開催。アンケートは7月20日まで'
let picked = pickDeadline(extractDates(text, BASE), BASE)
check(
  '近い予定より遠い締切を優先',
  picked !== null && picked.kind === 'deadline' && picked.date.getDate() === 20,
  picked ? `${picked.kind} ${fmt(picked.date)}` : 'null',
)

// 締切が無ければ最も近い未来の予定
text = '説明会は7月18日と7月12日に開催します'
picked = pickDeadline(extractDates(text, BASE), BASE)
check(
  '締切なしなら最も近い予定を選ぶ',
  picked !== null && picked.kind === 'event' && picked.date.getDate() === 12,
  picked ? `${picked.kind} ${fmt(picked.date)}` : 'null',
)

// 基準から24時間以内の過去はまだ拾う(「期限切れ」を見せるための猶予)
text = '7月9日 17:00までにご提出ください'
picked = pickDeadline(extractDates(text, BASE), BASE) // BASE=7/10 15:00、締切は22時間前
check(
  '24時間以内に過ぎた締切はまだ選ぶ',
  picked !== null && picked.kind === 'deadline',
  picked ? `${picked.kind} ${fmt(picked.date)}` : 'null',
)
check(
  '選んだ直近過去の締切は期限切れ表示',
  picked !== null && formatRemaining(picked.date, BASE) === '期限切れ',
)

// 24時間を超えて過ぎた締切は選ばない
text = '7月8日 12:00までにご提出ください'
picked = pickDeadline(extractDates(text, BASE), BASE)
check('丸1日以上過ぎた締切は選ばない', picked === null, picked ? fmt(picked.date) : '')

// 過去の締切しかなくても未来の予定があればそちらを選ぶ
text = '7月8日が提出期限でした。次回の会社説明会は7月18日です'
picked = pickDeadline(extractDates(text, BASE), BASE)
check(
  '過去締切+未来予定なら予定を選ぶ',
  picked !== null && picked.kind === 'event' && picked.date.getDate() === 18,
  picked ? `${picked.kind} ${fmt(picked.date)}` : 'null',
)

check('日付ゼロなら null', pickDeadline([], BASE) === null)

// ---------------------------------------------------------------
// 5. 時刻付きの抽出
// ---------------------------------------------------------------
ds = extractDates('7/15 23:59まで受け付けます', BASE)
check(
  'HH:MM形式の時刻を抽出',
  ds.length === 1 && ds[0].hasTime && sameMoment(ds[0].date, 2026, 7, 15, 23, 59),
  ds[0] ? fmt(ds[0].date) : 'なし',
)

ds = extractDates('7月15日(水) 17時から面接を行います', BASE)
check(
  '「17時」形式+曜日括弧も抽出',
  ds.length === 1 && ds[0].hasTime && sameMoment(ds[0].date, 2026, 7, 15, 17, 0),
  ds[0] ? fmt(ds[0].date) : 'なし',
)

// 時刻は改行を跨いで拾わない(次行の時刻を誤って紐付けない)
ds = extractDates('面接日: 7月20日\n13:00開始', BASE)
check(
  '改行を跨いだ時刻は紐付けない',
  ds.length === 1 && !ds[0].hasTime,
  ds[0] ? `hasTime=${ds[0].hasTime} ${fmt(ds[0].date)}` : 'なし',
)

// 存在しない時刻(25時)は日付ごと捨てられる(現状仕様の記録)
ds = extractDates('7/15 25:00まで', BASE)
check('不正時刻(25時)は日付ごと抽出しない', ds.length === 0, `件数=${ds.length}`)

// ---------------------------------------------------------------
// 6. formatRemaining
// ---------------------------------------------------------------
const NOW = new Date(2026, 6, 10, 10, 0)
const after = (ms: number) => new Date(NOW.getTime() + ms)
const H = 3600e3

check('過去は「期限切れ」', formatRemaining(after(-H), NOW) === '期限切れ')
check('30分後は「あと30分」', formatRemaining(after(30 * 60e3), NOW) === 'あと30分')
check('30秒後でも最低「あと1分」', formatRemaining(after(30e3), NOW) === 'あと1分')
check('3時間後は「あと3時間」', formatRemaining(after(3 * H), NOW) === 'あと3時間')
check('当日22時(12時間後)は「今日中」', formatRemaining(after(12 * H), NOW) === '今日中')
check(
  '翌日18時は「明日まで」',
  formatRemaining(new Date(2026, 6, 11, 18, 0), NOW) === '明日まで',
)
check(
  '3日後は「あと3日」',
  formatRemaining(new Date(2026, 6, 13, 9, 0), NOW) === 'あと3日',
)
// 深夜跨ぎでも6時間未満なら日付でなく時間で表示する(現状仕様の記録)
const LATE = new Date(2026, 6, 10, 23, 0)
check(
  '深夜跨ぎ4時間後は「明日まで」でなく「あと4時間」',
  formatRemaining(new Date(2026, 6, 11, 3, 0), LATE) === 'あと4時間',
  formatRemaining(new Date(2026, 6, 11, 3, 0), LATE),
)

// ---------------------------------------------------------------
// 7. urgencyOf
// ---------------------------------------------------------------
check('締切なしは normal', urgencyOf(null, NOW) === 'normal')
check('期限超過は overdue', urgencyOf(after(-H), NOW) === 'overdue')
check('12時間後は critical', urgencyOf(after(12 * H), NOW) === 'critical')
check('ちょうど24時間後は soon(criticalでない)', urgencyOf(after(24 * H), NOW) === 'soon')
check('48時間後は soon', urgencyOf(after(48 * H), NOW) === 'soon')
check('5日後は normal', urgencyOf(after(5 * 24 * H), NOW) === 'normal')

// ---------------------------------------------------------------
// 8. formatDateShort
// ---------------------------------------------------------------
check(
  '曜日と時刻つき短縮表示',
  formatDateShort(new Date(2026, 0, 1, 9, 5), true) === '1/1(木) 9:05',
  formatDateShort(new Date(2026, 0, 1, 9, 5), true),
)
check(
  'hasTime=false なら時刻を出さない',
  formatDateShort(new Date(2026, 0, 1, 9, 5), false) === '1/1(木)',
  formatDateShort(new Date(2026, 0, 1, 9, 5), false),
)

if (failed) {
  console.error(`\n${failed}件失敗`)
  process.exit(1)
}
console.log('\nすべて通過')
