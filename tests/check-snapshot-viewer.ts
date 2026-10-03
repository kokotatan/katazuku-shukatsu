/** 架空データと未完了提出物が、正本を壊さず見る窓へ届くことを検証する。 */
import assert from 'node:assert/strict'
import { buildDemoSnapshot, buildSnapshot } from '../scripts/snapshot.js'
import { openDb } from '../src/db.js'
import { applySubmissionRequirements, completeRequirement, setRequirementPreparation } from '../src/submission-requirement.js'
import { parseSnapshot } from '../shared/src/index.js'

const now = new Date('2026-10-03T23:30:00Z') // 日本時間は翌日
const demo = buildDemoSnapshot(now)
assert.equal(parseSnapshot(demo).demo, true)
for (const value of [null, [], {}, { ...demo, appointments: null }, { ...demo, companies: [null] }, { ...demo, generatedAt: 'not-a-date' }, { ...demo, submissionRequirements: {} }]) {
  assert.throws(() => parseSnapshot(value), /形式が不正/)
}
assert.equal(demo.demo, true)
assert.equal(demo.generatedAt, now.toISOString())
const requirements = demo.submissionRequirements as Array<Record<string, unknown>>
assert.equal(requirements.length, 2)
assert.equal(String(requirements[0].deadline).slice(0, 10), '2026-10-06')
assert(!requirements.some((row) => /期限超過/.test(String(row.requiredAction))))
const selections = demo.selections as Array<{ nextDate: string }>
assert(selections.some((row) => row.nextDate === '2026-10-06'))

const db = openDb(':memory:')
try {
  applySubmissionRequirements(db, [
    { company: '会社A', kind: 'pledge', title: '誓約書', deadline: '2099-01-01', sourceRef: 'synthetic-a', status: 'required' },
    { company: '会社A', kind: 'insurance_certificate', title: '保険証明書', sourceRef: 'synthetic-b', status: 'required' },
  ])
  const first = buildSnapshot(db, false).submissionRequirements as Array<{ id: number; title: string }>
  assert.equal(first.length, 2)
  const pledge = first.find((row) => row.title === '誓約書')!
  setRequirementPreparation(db, pledge.id, 'ready_for_approval', { preparationRef: 'synthetic-prepared' })
  const second = buildSnapshot(db, false).submissionRequirements as Array<{ id: number; preparationStatus: string }>
  assert.equal(second.length, 2, '承認待ちは完了にしない')
  assert.equal(second.find((row) => row.id === pledge.id)?.preparationStatus, 'ready_for_approval')
  completeRequirement(db, pledge.id, 'synthetic-completion')
  const third = buildSnapshot(db, false).submissionRequirements as Array<{ title: string }>
  assert.deepEqual(third.map((row) => row.title), ['保険証明書'], '別の提出物を完了扱いしない')
  assert(!JSON.stringify(third).includes('synthetic-completion'), '完了根拠IDを閲覧側へ増やさない')
} finally { db.close() }
console.log('閲覧スナップショット: 日本時間のデモ日付・未完了成果物・承認待ち・個別完了 OK')
