/**
 * 効果集計ロジック(lib/outcome.ts)の動作チェック。
 * 実行: cd impact && npx tsx scripts/check-outcome.ts
 */
import { AUTO_SEC, computeOutcome, formatDuration, MANUAL_SEC } from '../src/lib/outcome'
import type { InboxEmail, PipelineCompany } from '../src/types'

let failed = 0
function check(label: string, cond: boolean) {
  console.log(`${cond ? 'OK ' : 'NG '} ${label}`)
  if (!cond) failed++
}

const email = (p: Partial<InboxEmail>): InboxEmail => ({
  id: 'e', company: '会社', subject: '件名', deadline: null,
  needsAction: false, status: 'inbox', ...p,
})
const company = (p: Partial<PipelineCompany>): PipelineCompany => ({
  id: 'c', name: '企業', stage: 'task', nextAction: '', nextDate: null, ...p,
})

const emails: InboxEmail[] = [
  email({ id: '1', selectionKind: 'promo' }),
  email({ id: '2', selectionKind: 'promo' }),
  email({ id: '3', deadline: '2026-07-20T10:00:00', needsAction: true }),
  email({ id: '4', deadline: '2026-07-21T10:00:00', needsAction: true }),
  email({ id: '5', deadline: '2026-07-22T10:00:00', needsAction: true, status: 'done' }),
  email({ id: '6', needsAction: true }),
]
// totalEmails=6, promo=2, deadlines=3, actions=4, done=1

const companies: PipelineCompany[] = [
  company({ id: 'a', stage: 'interview' }),
  company({ id: 'b', stage: 'entried' }),
  company({ id: 'c', stage: 'offer' }),
  company({ id: 'd', stage: 'closed' }),
]
// activeCompanies=2(interview+entried), offers=1, interviews=1

const o = computeOutcome(emails, companies)

check('総メール=6', o.totalEmails === 6)
check('弾いた宣伝=2', o.promo === 2)
check('拾った締切=3', o.deadlines === 3)
check('立てたやること=4', o.actions === 4)
check('片付けた=1', o.done === 1)
check('進行中の選考=2', o.activeCompanies === 2)
check('面接=1', o.interviews === 1)
check('内定=1(進行中に二重計上しない)', o.offers === 1)

const sort = o.domains.find((d) => d.key === 'sort')!
const dl = o.domains.find((d) => d.key === 'deadline')!
const ac = o.domains.find((d) => d.key === 'action')!
check('仕分けの対象=総メール数', sort.count === 6)
check('締切の対象=締切数', dl.count === 3)
check('やることの対象=要対応数', ac.count === 4)
check('仕分けmanual=件数×MANUAL_SEC', sort.manualSec === 6 * MANUAL_SEC.sort)
check('仕分けauto=件数×AUTO_SEC', sort.autoSec === 6 * AUTO_SEC.sort)
check('各domainのsaved=manual-auto', o.domains.every((d) => d.savedSec === d.manualSec - d.autoSec))

const expManual = 6 * MANUAL_SEC.sort + 3 * MANUAL_SEC.deadline + 4 * MANUAL_SEC.action
const expAuto = 6 * AUTO_SEC.sort + 3 * AUTO_SEC.deadline + 4 * AUTO_SEC.action
check('合計manual', o.manualSec === expManual)
check('合計auto', o.autoSec === expAuto)
check('合計saved=manual-auto', o.savedSec === expManual - expAuto)

// 空データでも落ちない
const z = computeOutcome([], [])
check('空データ:全部0', z.totalEmails === 0 && z.savedSec === 0 && z.manualSec === 0)

// 整形
check('format 45分', formatDuration(45 * 60) === '45分')
check('format 90分=1時間30分', formatDuration(90 * 60) === '1時間30分')
check('format 120分=2時間', formatDuration(120 * 60) === '2時間')
check('format 0秒=0分', formatDuration(0) === '0分')

if (failed) {
  console.error(`\n${failed}件失敗`)
  process.exit(1)
}
console.log('\nすべて通過')
