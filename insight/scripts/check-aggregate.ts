/**
 * Today集約ロジック(lib/aggregate.ts)の動作チェック。
 * 実行: cd insight && npx tsx scripts/check-aggregate.ts
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
  needsAction: true, status: 'inbox', selectionKind: 'selection', ...p,
})
const company = (p: Partial<PipelineCompany>): PipelineCompany => ({
  id: 'c', name: '企業', stage: 'task', nextAction: 'ES提出', nextDate: null, ...p,
})

const b = aggregate(
  [
    email({ id: 'a', company: 'A社', deadline: '2026-06-11T12:00:00', subject: '昨日期限' }),
    email({ id: 'b', company: 'B社', deadline: '2026-06-12T17:00:00', subject: '今日期限' }),
    email({ id: 'c', company: 'C社', deadline: '2026-06-15T12:00:00', subject: '今週' }),
    email({ id: 'd', company: 'D社', deadline: '2026-06-25T12:00:00', subject: '先' }),
    email({ id: 'e', company: 'E社', deadline: null, subject: '期限なし要対応' }),
    email({ id: 'f', company: 'F社', deadline: '2026-06-12T10:00:00', status: 'done', subject: '済み' }),
    email({ id: 'g', company: 'G社', deadline: '2026-06-12T10:00:00', needsAction: false, subject: '対応不要' }),
    email({ id: 'h', company: 'H社', deadline: '2026-06-12T11:00:00', status: 'snoozed', snoozeUntil: '2026-06-12T08:00:00', subject: 'スヌーズ復帰' }),
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

// ---- 精度改善(2026-07-12): 宣伝の除外と、同じ会社×同じ日の1行化 ----

const b2 = aggregate(
  [
    // 同じ会社×同じ日×3通 → 1行にまとまる(一番早い期限を残す)
    email({ id: 'i1', company: 'アイリスオーヤマ', deadline: '2026-06-12T10:00:00', actionHint: 'イベントを予約' }),
    email({ id: 'i2', company: 'アイリスオーヤマ', deadline: '2026-06-12T18:00:00' }),
    email({ id: 'i3', company: 'アイリスオーヤマ', deadline: '2026-06-12T23:59:00' }),
    // 同じ会社でも別の日なら別の行
    email({ id: 'i4', company: 'アイリスオーヤマ', deadline: '2026-06-14T23:59:00' }),
    // 宣伝は needsAction が立っていても(旧データ)載せない
    email({ id: 'p', company: '外資就活ドットコム', deadline: '2026-06-12T23:59:00', selectionKind: 'promo' }),
    // 就活外も載せない
    email({ id: 'o', company: 'カード会社', deadline: '2026-06-12T23:59:00', selectionKind: 'other' }),
    // selectionKind の無い古いデータは従来どおり載せる
    (() => {
      const m = email({ id: 'legacy', company: '旧データ社', deadline: '2026-06-12T23:59:00' })
      delete m.selectionKind
      return m
    })(),
  ],
  [],
  now,
)

check('宣伝(promo)は載らない', !b2.today.some((i) => i.company === '外資就活ドットコム'))
check('就活外(other)は載らない', !b2.today.some((i) => i.company === 'カード会社'))
check('旧データ(selectionKindなし)は載る', b2.today.some((i) => i.company === '旧データ社'))
const iris = b2.today.filter((i) => i.company === 'アイリスオーヤマ')
check('同じ会社×同じ日は1行にまとまる', iris.length === 1)
check('まとめ行は一番早い期限を残す', iris[0]?.due === '2026-06-12T10:00:00')
check('まとめ行に他件数が付く', /他2件/.test(iris[0]?.title ?? ''))
check('別の日の分は別の行(今週側)', b2.week.some((i) => i.company === 'アイリスオーヤマ'))

if (failed) {
  console.error(`\n${failed}件失敗`)
  process.exit(1)
}
console.log('\nすべて通過')
