/**
 * Today集約ロジック(lib/aggregate.ts)の動作チェック。
 * 実行: cd today && npx tsx scripts/check-aggregate.ts
 */
import { aggregate } from '../src/lib/aggregate'
import type { InboxEmail, PipelineCompany } from '../src/types'

let failed = 0
function check(label: string, cond: boolean) {
  console.log(`${cond ? 'OK ' : 'NG '} ${label}`)
  if (!cond) failed++
}

const now = new Date('2026-06-12T09:00:00')
const email = (p: Partial<InboxEmail>): InboxEmail => ({
  id: 'e', company: '会社', subject: '件名', deadline: null,
  needsAction: true, status: 'inbox', ...p,
})
const company = (p: Partial<PipelineCompany>): PipelineCompany => ({
  id: 'c', name: '企業', stage: 'task', nextAction: 'ES提出', nextDate: null, ...p,
})

const b = aggregate(
  [
    email({ id: 'a', deadline: '2026-06-11T12:00:00', subject: '昨日期限' }),
    email({ id: 'b', deadline: '2026-06-12T17:00:00', subject: '今日期限' }),
    email({ id: 'c', deadline: '2026-06-15T12:00:00', subject: '今週' }),
    email({ id: 'd', deadline: '2026-06-25T12:00:00', subject: '先' }),
    email({ id: 'e', deadline: null, subject: '期限なし要対応' }),
    email({ id: 'f', deadline: '2026-06-12T10:00:00', status: 'done', subject: '済み' }),
    email({ id: 'g', deadline: '2026-06-12T10:00:00', needsAction: false, subject: '対応不要' }),
    email({ id: 'h', deadline: '2026-06-12T11:00:00', status: 'snoozed', snoozeUntil: '2026-06-12T08:00:00', subject: 'スヌーズ復帰' }),
  ],
  [
    company({ id: 'p1', nextDate: '2026-06-12' }),
    company({ id: 'p2', nextDate: '2026-06-14' }),
    company({ id: 'p3', nextDate: '2026-06-14', stage: 'closed' }),
    company({ id: 'p4', nextDate: null }),
  ],
  now,
)

check('期限切れ=1件(昨日)', b.overdue.length === 1 && b.overdue[0].key === 'inbox-a')
check('今日=3件(メール2+ボード1)', b.today.length === 3)
check('スヌーズ復帰分が今日に入る', b.today.some((i) => i.key === 'inbox-h'))
check('今日の並びは時刻順', b.today[0].key === 'inbox-h' && b.today[2].key === 'pipeline-p1')
check('今週=2件(メール1+ボード1)', b.week.length === 2)
check('終了ステージ・日付なしのボードは出ない', !b.week.some((i) => i.key === 'pipeline-p3' || i.key === 'pipeline-p4'))
check('7日より先=1件', b.laterCount === 1)
check('期限なし要対応=1件', b.datelessCount === 1)
check('済み・対応不要は出ない', ![...b.overdue, ...b.today, ...b.week].some((i) => i.key === 'inbox-f' || i.key === 'inbox-g'))
check('ボードの行タイトルはnextAction', b.today.find((i) => i.key === 'pipeline-p1')?.title === 'ES提出')

if (failed) {
  console.error(`\n${failed}件失敗`)
  process.exit(1)
}
console.log('\nすべて通過')
