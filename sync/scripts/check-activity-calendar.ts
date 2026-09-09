/** 日付の境界・記録の出典・重複除去を検証する。確認用の値は配信コードへ含めない。 */
import assert from 'node:assert/strict'
import type { KatazukuData } from '../../shared/src/index'
import { buildActivityTimeline, entriesOnDay, monthDays, recordTime, safeReferenceUrl, shiftMonth, todayInJapan } from '../../impact/src/lib/activity'

let passed = 0
function check(label: string, run: () => void) { run(); passed++; console.log(`OK ${label}`) }
const data = (changes: Partial<KatazukuData> = {}): KatazukuData => ({
  generatedAt: '', companies: [], selections: [], appointments: [], events: [], enrichedEvents: [], activities: [],
  profile: {}, profileSuggestions: [], people: [], personNotes: [], interviews: [], submissions: [], dossiers: [], meetingRuns: [], mailItems: [], ...changes,
})

check('UTCの日付境界を日本時間の翌日へ揃える', () => {
  assert.equal(recordTime('2026-09-07T15:30:00Z')?.day, '2026-09-08')
  assert.equal(recordTime('2026-09-07T15:30:00Z')?.time, '00:30')
  assert.equal(todayInJapan(new Date('2026-09-07T15:00:00Z')), '2026-09-08')
})
check('オフセットなしは日本時間、日付だけなら時刻を作らない', () => {
  assert.equal(recordTime('2026-09-08 10:30:00')?.time, '10:30')
  assert.equal(recordTime('2026-09-08')?.time, '')
})
check('存在しない日付・時刻を別の日へ丸めない', () => {
  for (const value of ['2026-02-30', '2026-02-30T10:00:00Z', '2026-09-08T25:00:00', '', '未設定']) assert.equal(recordTime(value), null)
})
check('月末からの月移動と年越し', () => {
  assert.equal(shiftMonth('2026-01-31', 1), '2026-02-28')
  assert.equal(shiftMonth('2024-01-31', 1), '2024-02-29')
  assert.equal(shiftMonth('2026-12-08', 1), '2027-01-08')
})
check('月表示は日曜から必要な週数、隣月の日付も一意', () => {
  const days = monthDays('2026-09-08')
  assert.equal(days[0], '2026-08-30')
  assert.equal(days.at(-1), '2026-10-03')
  assert.equal(new Set(days).size, 35)
  assert.equal(monthDays('2026-08-01').length, 42)
  assert.equal(monthDays('2026-02-01').length, 28)
})
check('実際の活動ログのts/action/by/why/how/resultを読む', () => {
  const { entries } = buildActivityTimeline(data({ activities: [{ ts: '2026-09-08T10:00:00+09:00', by: 'codex', action: '作業内容', why: '目的', how: '保存済みの要約', result: '成功' }] }))
  assert.equal(entries[0].title, '作業内容')
  assert.equal(entries[0].summary, '保存済みの要約')
  assert.equal(entries[0].category, 'conversation')
  assert.equal(entries[0].label, 'Codexの作業記録')
  assert.ok(entries[0].details.some(item => item.value === '目的'))
})
check('旧形式の活動ログも読める', () => {
  const { entries } = buildActivityTimeline(data({ activities: [{ at: '2026-09-08', what: '旧記録', why: '目的' }] }))
  assert.equal(entries[0].title, '旧記録')
  assert.equal(entries[0].time, '')
})
check('メールの現在の返信済み状態から返信日時を捏造しない', () => {
  const { entries } = buildActivityTimeline(data({ mailItems: [{ id: 'check', receivedAt: '2026-09-07T10:00:00+09:00',
    subject: '受信記録', sender: '', summary: '', category: '', needsAction: false, deadline: '', status: '返信済み', sourceRef: '' }] }))
  assert.equal(entries.length, 1)
  assert.equal(entries[0].day, '2026-09-07')
  assert.equal(entries[0].label, 'メール受信')
  assert.equal(entriesOnDay(entries, '2026-09-08').length, 0)
})
check('返信の実施記録は実際の日時でメールに含める', () => {
  const { entries } = buildActivityTimeline(data({ submissions: [{ id: 1, kind: '日程承諾返信', submittedAt: '2026-09-08T09:00:00+09:00', result: '送信済み' }] }))
  assert.equal(entriesOnDay(entries, '2026-09-08', 'mail').length, 1)
})
check('対話中のメール対応もメールから探せる', () => {
  const { entries } = buildActivityTimeline(data({ activities: [{ ts: '2026-09-08', by: 'codex', action: '返信を確認', how: '保存済みの確認結果' }] }))
  assert.equal(entriesOnDay(entries, '2026-09-08', 'mail').length, 1)
  assert.equal(entries[0].label, 'Codexの作業記録')
})
check('eventsとenrichedEventsにある同じ記録は重ねない', () => {
  const event = { at: '2026-09-08T10:00:00+09:00', kind: '予定訂正', summary: '訂正の記録', source: 'conversation-agent' }
  const { entries } = buildActivityTimeline(data({ events: [{ ...event, selection_id: 1 }], enrichedEvents: [{ ...event, selectionId: 1, id: 2, company: '保存済みの会社名' }] }))
  assert.equal(entries.length, 1)
  assert.equal(entries[0].company, '保存済みの会社名')
  assert.equal(entries[0].category, 'conversation')
})
check('同じ出典の提出記録と対応するeventを重ねない', () => {
  const { entries } = buildActivityTimeline(data({ submissions: [{ id: 1, kind: '提出', sourceRef: 'check:submission', submittedAt: '2026-09-08' }],
    enrichedEvents: [{ id: 2, selectionId: 1, at: '2026-09-08', kind: '提出結果', source: 'submit-agent', ref: 'check:submission' }] }))
  assert.equal(entries.length, 1)
})
check('複数日の予定は中間日にも表示し、終了0時の日は含めない', () => {
  const { entries } = buildActivityTimeline(data({ appointments: [{ id: 1, selectionId: 1, company: '', at: '2026-09-07T10:00:00+09:00',
    endAt: '2026-09-10T00:00:00+09:00', kind: '予定', title: '保存済みの予定', url: '', location: '', person: '', status: '予定' }] }))
  assert.equal(entriesOnDay(entries, '2026-09-08').length, 1)
  assert.equal(entriesOnDay(entries, '2026-09-09').length, 1)
  assert.equal(entriesOnDay(entries, '2026-09-10').length, 0)
  assert.equal(entries[0].details.find(item => item.label === '状態')?.value, '予定')
})
check('不明な日付を今日へ割り当てず、未分類の記録として残す', () => {
  const result = buildActivityTimeline(data({ activities: [{ ts: '日付不明', action: '保存済みの記録' }] }))
  assert.equal(result.entries.length, 0)
  assert.equal(result.undated.length, 1)
})
check('順序と種類による絞り込み', () => {
  const { entries } = buildActivityTimeline(data({ activities: [
    { ts: '2026-09-08T12:00:00+09:00', by: 'mail-watch', action: 'メール確認' },
    { ts: '2026-09-08T09:00:00+09:00', by: 'calendar-sync', action: '同期' },
  ] }))
  assert.equal(entries[0].time, '09:00')
  assert.equal(entriesOnDay(entries, '2026-09-08', 'mail').length, 1)
  assert.equal(entriesOnDay(entries, '2026-09-08', 'automation').length, 1)
})
check('空の実データを補完しない', () => assert.deepEqual(buildActivityTimeline(data()), { entries: [], undated: [] }))
check('参照先はWeb URLのみリンクにし、コードやローカルパスを実行しない', () => {
  assert.equal(safeReferenceUrl('https://example.com/record'), 'https://example.com/record')
  for (const value of ['javascript:alert(1)', 'data:text/html,check', 'C:\\logs\\record.md', 'logs/record.md', 'https://user:password@example.com']) assert.equal(safeReferenceUrl(value), undefined)
})
console.log(`活動カレンダー: ${passed}項目成功`)
