import {
  assessDailySyncMails,
  routeJevAssessment,
  toJevMailState,
  type JevMailEvaluator,
  type JevMailJudgment,
} from '../src/jev-decision'
import {
  parseLlmDecisionResult,
  renderLlmDecisionPrompt,
  resolveDecisionControlConfig,
  routeAtomicDecision,
  type AtomicDecisionRequest,
} from '../src/decision-control'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

let failed = 0
async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
    console.log(`  OK  ${name}`)
  } catch (error) {
    failed += 1
    console.error(`  NG  ${name}: ${(error as Error).message}`)
  }
}

const base: JevMailJudgment = {
  model: 'jev-test',
  category: 'information',
  categoryConfidence: 0.9,
  probabilities: { information: 0.9, other: 0.1 },
  recruitingRelevance: 0.7,
  needsAction: 0.3,
  timeSensitive: 0.2,
  inputTokens: 10,
  outputTokens: 1,
}

const atomicRequest: AtomicDecisionRequest = {
  state: { subject: '面談候補日の確認', summary: '候補日を返信する必要がある' },
  questions: {
    needs_action: { type: 'boolean', instructions: '本人の対応が必要か' },
    category: { type: 'choice', instructions: '主目的を選ぶ', criteria: { scheduling: null, information: null } },
  },
}

await check('個人版の既定backendはLLMで、Jev型の原子的判断を要求する', () => {
  const config = resolveDecisionControlConfig({}, {})
  assert(config.backend === 'llm', JSON.stringify(config))
  const prompt = renderLlmDecisionPrompt(atomicRequest)
  assert(prompt.includes('文章生成ではなく') && prompt.includes('各質問は他の質問から独立'), prompt)
})

await check('LLMの自由記述を拒否し、厳格な確率JSONだけを受理する', () => {
  const result = parseLlmDecisionResult(JSON.stringify({
    schemaVersion: 1,
    backend: 'llm',
    model: 'fixture-model',
    answers: {
      needs_action: { type: 'boolean', probability: 0.91 },
      category: { type: 'choice', choice: 'scheduling', confidence: 0.88, probabilities: { scheduling: 0.88, information: 0.12 } },
    },
  }), atomicRequest)
  assert(result.answers.needs_action.type === 'boolean', JSON.stringify(result))
  let rejected = false
  try { parseLlmDecisionResult('判断結果です: {}', atomicRequest) } catch { rejected = true }
  assert(rejected, '自由記述を拒否していません')
})

await check('閾値未満はLLMに自動判断させずreviewへ送る', () => {
  assert(routeAtomicDecision({ type: 'boolean', probability: 0.7 }).status === 'review', '曖昧な判断を通しました')
  assert(routeAtomicDecision({ type: 'boolean', probability: 0.93 }).status === 'decided', '高確度判断を止めました')
})

await check('Jev設定はAPIキーなしで有効化できない', () => {
  let rejected = false
  try { resolveDecisionControlConfig({ agent: { decision_control: { backend: 'jev' } } }, {}) } catch { rejected = true }
  assert(rejected, 'APIキーなしのJevを許可しました')
})

await check('外部送信stateからIDとメールlocal-partを除外する', () => {
  const state = toJevMailState({
    id: 'gmail-secret-id',
    subject: '説明会のご案内',
    sender: 'Recruiter Name <private.person@example.co.jp>',
    summary: '来週開催',
  })
  const serialized = JSON.stringify(state)
  assert(state.senderDomain === 'example.co.jp', JSON.stringify(state))
  assert(!serialized.includes('gmail-secret-id'), 'メールIDが外部stateへ混入しています')
  assert(!serialized.includes('private.person'), 'メールアドレスのlocal-partが外部stateへ混入しています')
})

await check('高優先度の可能性をreviewへ送る', () => {
  const result = routeJevAssessment(
    { id: '1', subject: '面接予約', category: '日程', needsAction: true },
    { ...base, category: 'scheduling', timeSensitive: 0.91, needsAction: 0.95 },
  )
  assert(result.route === 'review', JSON.stringify(result))
  assert(result.reasons.some((reason) => reason.includes('期限・予約')), JSON.stringify(result))
})

await check('強い不一致だけをreviewへ送り、Jevで既存判断を上書きしない', () => {
  const result = routeJevAssessment(
    { id: '1', subject: '提出', category: '提出物', needsAction: false },
    { ...base, category: 'submission', needsAction: 0.92 },
  )
  assert(result.route === 'review', JSON.stringify(result))
  assert(result.reasons.some((reason) => reason.includes('対応不要')), JSON.stringify(result))
})

await check('匿名fixtureを並列評価し、入力順とusageを保持する', async () => {
  const seen: string[] = []
  const fake: JevMailEvaluator = {
    async evaluate(state) {
      seen.push(state.subject)
      return { ...base, model: 'jev-fixture', inputTokens: 7, outputTokens: 2 }
    },
  }
  const result = await assessDailySyncMails([
    { id: 'a', subject: 'A' },
    { id: 'b', subject: 'B' },
  ], fake, { concurrency: 2, now: new Date('2026-09-17T00:00:00Z') })
  assert(seen.length === 2, JSON.stringify(seen))
  assert(result.items.map((item) => item.id).join(',') === 'a,b', JSON.stringify(result.items))
  assert(result.usage.inputTokens === 14 && result.usage.outputTokens === 4, JSON.stringify(result.usage))
  assert(result.policy === 'advisory-only', JSON.stringify(result))
})

console.log(`Jev判断アダプター: ${failed === 0 ? '全件成功' : `${failed}件失敗`}`)
if (failed) process.exit(1)
