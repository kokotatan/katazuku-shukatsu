import assert from 'node:assert/strict'
import { createSparkJob, sparkPrompt, validateSparkResponse } from '../src/spark-handoff.js'

const now = new Date('2026-09-26T03:00:00Z')
const job = createSparkJob('document', '架空の文章を要約', now)
const payload = { summary: '要約', content: '本文', sources: [], unknowns: [] }
const answer = JSON.stringify({ runId: job.runId, inputHash: job.inputHash, payload })
assert.deepEqual(validateSparkResponse(job, answer, now), payload)
assert.deepEqual(validateSparkResponse(job, '```json\n' + answer + '\n```', now), payload)
assert.throws(() => validateSparkResponse(job, answer.replace(job.runId, 'other'), now))
assert.throws(() => validateSparkResponse(job, answer.replace(job.inputHash, 'other'), now))
assert.throws(() => validateSparkResponse({ ...job, input: '差替え' }, answer, now))
assert.throws(() => validateSparkResponse(job, answer, new Date('2026-09-28T00:00:00Z')))
assert.throws(() => validateSparkResponse(job, answer, new Date('2026-09-25T00:00:00Z')))
assert.throws(() => validateSparkResponse(job, answer.slice(0, -1), now))
assert.throws(() => validateSparkResponse(job, '回答です\n' + answer, now))
assert.throws(() => validateSparkResponse(job, answer.replace('"content":"本文",', ''), now))
assert.throws(() => validateSparkResponse(job, answer.replace('"sources":[]', '"sources":[{"title":"出典","url":"javascript:alert(1)"}]'), now))
assert.throws(() => validateSparkResponse(job, answer.replace('"payload":', '"approved":true,"payload":'), now))
assert.throws(() => createSparkJob('send', '送信', now))
assert.throws(() => createSparkJob('document', '', now))
assert.throws(() => validateSparkResponse(job, 'x'.repeat(1_000_001), now))
const daily = createSparkJob('daily-sync', '架空メール', now)
const wrap = (j: typeof job, p: unknown) => JSON.stringify({ runId: j.runId, inputHash: j.inputHash, payload: p })
assert.doesNotThrow(() => validateSparkResponse(daily, wrap(daily, { schemaVersion: 1, selections: [], mailItems: [], submissions: [], requirements: [] }), now))
assert.throws(() => validateSparkResponse(daily, wrap(daily, { schemaVersion: 1, selections: [], mailItems: [], submissions: [] }), now))
const research = createSparkJob('research', '架空企業', now)
const r = { sourceRef: research.runId, company: '架空企業', summary: '試験', researchedAt: now.toISOString(), facts: {}, sources: [{ title: '公式', url: 'https://example.com/' }] }
assert.doesNotThrow(() => validateSparkResponse(research, wrap(research, r), now))
assert.throws(() => validateSparkResponse(research, wrap(research, { ...r, sources: [] }), now))
assert.throws(() => validateSparkResponse(research, wrap(research, { ...r, sourceRef: 'other' }), now))
for (const kind of ['meeting-prep', 'reply-draft']) {
  const j = createSparkJob(kind, '架空の資料', now)
  assert.doesNotThrow(() => validateSparkResponse(j, wrap(j, payload), now))
  assert.ok(sparkPrompt(j).includes('定期実行作成、DB更新はしない'))
}
console.log('Spark handoff: 正常系5用途・異常系・期限・根拠・Schema検証 OK')
