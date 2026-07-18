/**
 * 月別集計(lib/metrics.ts)の動作チェック。
 * 実行: cd impact && npx tsx scripts/check-metrics.ts
 */
import { computeMetrics } from '../src/lib/metrics'
import type { InboxEmail, PipelineCompany } from '../src/types'

let failed = 0
function check(label: string, cond: boolean) {
  console.log(`${cond ? 'OK ' : 'NG '} ${label}`)
  if (!cond) failed++
}

const now = new Date('2026-07-15T00:00:00')
const email = (p: Partial<InboxEmail>): InboxEmail => ({
  id: 'e', company: 'c', subject: 's', deadline: null, needsAction: false,
  status: 'inbox', receivedAt: '2026-07-01T00:00:00', ...p,
})

const emails: InboxEmail[] = [
  email({ id: '1', receivedAt: '2026-07-05T00:00:00', deadline: '2026-08-01T00:00:00', needsAction: true, selectionKind: 'selection' }),
  email({ id: '2', receivedAt: '2026-07-10T00:00:00', selectionKind: 'promo' }),
  email({ id: '3', receivedAt: '2026-06-10T00:00:00', deadline: '2026-07-01T00:00:00', needsAction: true }),
  email({ id: '4', receivedAt: '2026-07-02T00:00:00', status: 'done', doneAt: '2026-07-20T00:00:00' }),
  // 期間外(集計対象の12ヶ月より前) → 月バケツには入らないが内訳には数える
  email({ id: '5', receivedAt: '2024-01-01T00:00:00' }),
]
const companies: PipelineCompany[] = []

const m = computeMetrics(emails, companies, now)
const jul = m.months.find((b) => b.ym === '2026-07')!
const jun = m.months.find((b) => b.ym === '2026-06')!

check('12ヶ月ぶん', m.months.length === 12)
check('末尾は今月(7月)', m.months[11].ym === '2026-07' && m.months[11].label === '7月')
check('先頭は12ヶ月前(2025-08)', m.months[0].ym === '2025-08')
check('7月メール=3(e1,e2,e4)', jul.emails === 3)
check('7月締切=1(e1)', jul.deadlines === 1)
check('7月宣伝=1(e2)', jul.promo === 1)
check('7月やること=1(e1のみ)', jul.actions === 1)
check('7月片付け=1(e4のdoneAt月)', jul.done === 1)
check('6月メール=1(e3)', jun.emails === 1 && jun.deadlines === 1 && jun.actions === 1)
// savedMin: 3*18 + 1*35 + 1*25 = 114秒 → 2分
check('7月削減=2分', jul.savedMin === 2)

const sel = (k: string) => m.selection.find((s) => s.key === k)?.count ?? 0
check('内訳 選考=1', sel('selection') === 1)
check('内訳 宣伝=1', sel('promo') === 1)
check('内訳 未分類=3(e3,e4,e5)', sel('unknown') === 3)
check('内訳ラベルが日本語', m.selection.find((s) => s.key === 'selection')?.label === '選考')

// 期間外メールは月バケツに載らない(全月emails合計=4)
check('月バケツ合計emails=4(期間外e5は除外)', m.months.reduce((n, b) => n + b.emails, 0) === 4)

// 空でも落ちない
const z = computeMetrics([], [], now)
check('空:12ヶ月・全0', z.months.length === 12 && z.months.every((b) => b.emails === 0) && z.selection.length === 0)

if (failed) {
  console.error(`\n${failed}件失敗`)
  process.exit(1)
}
console.log('\nすべて通過')
