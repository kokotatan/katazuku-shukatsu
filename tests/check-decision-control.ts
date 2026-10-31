import { LlmAtomicDecisionEvaluator, TypeSafeJevDecisionEvaluator, parseLlmDecisionResult, renderLlmDecisionPrompt, resolveDecisionControlConfig, routeAtomicDecision, validateAtomicDecisionRequest, type AtomicDecisionRequest } from '../src/decision-control.js'

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }
const request: AtomicDecisionRequest = {
  state: { subject: '候補日の確認', summary: '返信が必要' },
  questions: {
    needs_action: { type: 'boolean', instructions: '本人の対応が必要か' },
    category: { type: 'choice', instructions: '主目的', criteria: { scheduling: null, information: null } },
  },
}
assert(renderLlmDecisionPrompt(request).includes('原子的な判断'), 'LLM制御プロンプトが不正です')
const llm = new LlmAtomicDecisionEvaluator(async () => JSON.stringify({
  schemaVersion: 1, backend: 'llm', model: 'example-model', answers: {
    needs_action: { type: 'boolean', probability: 0.91 },
    category: { type: 'choice', choice: 'scheduling', confidence: 0.9, probabilities: { scheduling: 0.9, information: 0.1 } },
  },
}))
const llmResult = await llm.evaluate(request)
assert(routeAtomicDecision(llmResult.answers.needs_action).status === 'decided', '高確度判断が通りません')
assert(routeAtomicDecision({ type: 'boolean', probability: 0.68 }).status === 'review', '曖昧な判断を自動化しました')
assert(resolveDecisionControlConfig({}, {}).backend === 'llm', '既定はLLMである必要があります')
let keyRejected = false
try { resolveDecisionControlConfig({ agent: { decision_control: { backend: 'jev' } } }, {}) } catch { keyRejected = true }
assert(keyRejected, 'APIキーなしのJevを許可しました')

const mustReject = (label: string, run: () => unknown) => {
  let rejected = false
  try { run() } catch { rejected = true }
  assert(rejected, label)
}
mustReject('requestの余分な命令を許可しました', () => validateAtomicDecisionRequest({ ...request, action: 'send' } as AtomicDecisionRequest))
mustReject('質問の余分な命令を許可しました', () => validateAtomicDecisionRequest({
  state: null,
  questions: { unsafe: { type: 'boolean', instructions: '判定', action: 'send' } },
} as unknown as AtomicDecisionRequest))
mustReject('回答の余分な項目を許可しました', () => parseLlmDecisionResult(JSON.stringify({
  schemaVersion: 1, backend: 'llm', model: 'fixture', execute: true,
  answers: {
    needs_action: { type: 'boolean', probability: 0.9 },
    category: { type: 'choice', choice: 'scheduling', confidence: 0.9, probabilities: { scheduling: 0.9, information: 0.1 } },
  },
}), request))
const scoreRequest: AtomicDecisionRequest = {
  state: null,
  questions: { priority: { type: 'score', instructions: '優先度', criteria: [null, null, null] } },
}
mustReject('小数のscoreを許可しました', () => parseLlmDecisionResult(JSON.stringify({
  schemaVersion: 1, backend: 'llm', model: 'fixture',
  answers: { priority: { type: 'score', score: 1.5, confidence: 0.9, probabilities: { 0: 0.1, 1: 0.8, 2: 0.1 } } },
}), scoreRequest))
mustReject('scoreの段階と異なる確率キーを許可しました', () => parseLlmDecisionResult(JSON.stringify({
  schemaVersion: 1, backend: 'llm', model: 'fixture',
  answers: { priority: { type: 'score', score: 1, confidence: 0.9, probabilities: { low: 0.1, medium: 0.8, high: 0.1 } } },
}), scoreRequest))
let capturedAuth = ''
const jev = new TypeSafeJevDecisionEvaluator({ apiKey: 'fixture-key', fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
  capturedAuth = new Headers(init?.headers).get('Authorization') ?? ''
  return new Response(JSON.stringify({ model: 'jev-fixture', answers: {
    needs_action: { type: 'noul', noul: 0.94 },
    category: { type: 'choice', choice: 'scheduling', confidence: 0.92, probabilities: { scheduling: 0.92, information: 0.08 } },
  } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}) as typeof fetch })
const jevResult = await jev.evaluate(request)
assert(jevResult.backend === 'jev' && capturedAuth === 'Bearer fixture-key', 'Jev adapterが不正です')
console.log('判断制御: LLM/Jev共通契約・閾値・設定・REST adapterを確認')
