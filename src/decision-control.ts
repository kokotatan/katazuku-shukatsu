export const DECISION_BACKENDS = ['llm', 'jev', 'off'] as const
export type DecisionBackend = typeof DECISION_BACKENDS[number]
export type DecisionValue = string | number | boolean | null | DecisionValue[] | { [key: string]: DecisionValue }
export type AtomicDecisionQuestion =
  | { type: 'boolean'; instructions: string; criteria?: { true?: DecisionValue; false?: DecisionValue } }
  | { type: 'choice'; instructions: string; criteria: Record<string, DecisionValue> }
  | { type: 'score'; instructions: string; criteria: [DecisionValue, DecisionValue, ...DecisionValue[]] }
export interface AtomicDecisionRequest { state: DecisionValue; questions: Record<string, AtomicDecisionQuestion> }
export type AtomicDecisionAnswer =
  | { type: 'boolean'; probability: number }
  | { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: 'score'; score: number; confidence: number; probabilities: Record<string, number> }
export interface AtomicDecisionResult {
  schemaVersion: 1
  backend: Exclude<DecisionBackend, 'off'>
  model: string
  answers: Record<string, AtomicDecisionAnswer>
}
export interface DecisionControlPolicy { minConfidence: number; autonomousThreshold: number }
export interface DecisionControlConfig extends DecisionControlPolicy { backend: DecisionBackend; jevModel: string }
export interface AtomicDecisionEvaluator { evaluate(request: AtomicDecisionRequest): Promise<AtomicDecisionResult> }
export const DEFAULT_DECISION_POLICY: DecisionControlPolicy = { minConfidence: 0.65, autonomousThreshold: 0.85 }

function asProbability(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${label}は0以上1以下の数値である必要があります`)
  return value
}

export function validateAtomicDecisionRequest(request: AtomicDecisionRequest): void {
  const entries = Object.entries(request?.questions ?? {})
  if (!entries.length) throw new Error('原子的な質問を1件以上指定してください')
  for (const [id, question] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id)) throw new Error(`質問IDが不正です: ${id}`)
    if (!question.instructions.trim()) throw new Error(`${id}: instructionsは必須です`)
    if (question.type === 'choice' && Object.keys(question.criteria).length < 2) throw new Error(`${id}: choiceには2候補以上必要です`)
    if (question.type === 'score' && question.criteria.length < 2) throw new Error(`${id}: scoreには2段階以上必要です`)
  }
}

/** 通常LLMを文章生成器ではなく、Jev型の原子的判断器として使うプロンプト。 */
export function renderLlmDecisionPrompt(request: AtomicDecisionRequest): string {
  validateAtomicDecisionRequest(request)
  return [
    'あなたは文章生成ではなく、機械が利用する原子的な判断だけを行います。',
    '各質問は他の質問から独立にstateだけで評価し、不足情報を補完しません。',
    '行動・説明・提案・自由記述を生成せず、JSONオブジェクト1つだけを返してください。',
    'booleanはtrueの確率、choice/scoreは候補ごとの確率とconfidenceを0..1で返します。',
    JSON.stringify({
      output: { schemaVersion: 1, backend: 'llm', model: '実際のモデル名', answers: { '<questionId>': { type: 'boolean | choice | score', probability: 0.5, confidence: 0.5, probabilities: {} } } },
      request,
    }, null, 2),
  ].join('\n')
}

function validateAnswer(id: string, question: AtomicDecisionQuestion, raw: unknown): AtomicDecisionAnswer {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${id}: 回答が不正です`)
  const answer = raw as Record<string, unknown>
  if (answer.type !== question.type) throw new Error(`${id}: 質問と回答の型が一致しません`)
  if (question.type === 'boolean') return { type: 'boolean', probability: asProbability(answer.probability, `${id}.probability`) }
  if (!answer.probabilities || typeof answer.probabilities !== 'object' || Array.isArray(answer.probabilities)) throw new Error(`${id}: probabilitiesが不正です`)
  const probabilities = Object.fromEntries(Object.entries(answer.probabilities as Record<string, unknown>).map(([key, value]) => [key, asProbability(value, `${id}.${key}`)]))
  if (question.type === 'choice') {
    if (typeof answer.choice !== 'string' || !Object.hasOwn(question.criteria, answer.choice)) throw new Error(`${id}: choiceが候補外です`)
    const expected = Object.keys(question.criteria).sort()
    if (JSON.stringify(Object.keys(probabilities).sort()) !== JSON.stringify(expected)) throw new Error(`${id}: 確率キーが候補と一致しません`)
    return { type: 'choice', choice: answer.choice, confidence: asProbability(answer.confidence, `${id}.confidence`), probabilities }
  }
  if (typeof answer.score !== 'number' || answer.score < 0 || answer.score > question.criteria.length - 1) throw new Error(`${id}: scoreが範囲外です`)
  return { type: 'score', score: answer.score, confidence: asProbability(answer.confidence, `${id}.confidence`), probabilities }
}

export function parseLlmDecisionResult(text: string, request: AtomicDecisionRequest): AtomicDecisionResult {
  validateAtomicDecisionRequest(request)
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) throw new Error('LLM判断はJSONオブジェクト1つだけで返してください')
  const value = JSON.parse(trimmed) as Record<string, unknown>
  if (value.schemaVersion !== 1 || value.backend !== 'llm' || typeof value.model !== 'string' || !value.model) throw new Error('判断結果のヘッダーが不正です')
  if (!value.answers || typeof value.answers !== 'object' || Array.isArray(value.answers)) throw new Error('answersが不正です')
  const rawAnswers = value.answers as Record<string, unknown>
  const expected = Object.keys(request.questions).sort()
  if (JSON.stringify(Object.keys(rawAnswers).sort()) !== JSON.stringify(expected)) throw new Error('質問IDと回答IDが一致しません')
  const answers = Object.fromEntries(expected.map((id) => [id, validateAnswer(id, request.questions[id], rawAnswers[id])]))
  return { schemaVersion: 1, backend: 'llm', model: value.model, answers }
}

export function routeAtomicDecision(answer: AtomicDecisionAnswer, policy: DecisionControlPolicy = DEFAULT_DECISION_POLICY): { status: 'decided' | 'review'; certainty: number; reason: string } {
  asProbability(policy.minConfidence, 'minConfidence')
  asProbability(policy.autonomousThreshold, 'autonomousThreshold')
  if (policy.autonomousThreshold < 0.5) throw new Error('autonomousThresholdは0.5以上にしてください')
  const certainty = answer.type === 'boolean' ? Math.max(answer.probability, 1 - answer.probability) : answer.confidence
  if (certainty < policy.minConfidence) return { status: 'review', certainty, reason: '確信度が最低基準未満' }
  if (certainty < policy.autonomousThreshold) return { status: 'review', certainty, reason: '自動判断の閾値未満' }
  return { status: 'decided', certainty, reason: '自動判断の閾値を満たす' }
}

export function routeDecisionResult(result: AtomicDecisionResult, policy: DecisionControlPolicy = DEFAULT_DECISION_POLICY) {
  return Object.fromEntries(Object.entries(result.answers).map(([id, answer]) => [id, routeAtomicDecision(answer, policy)]))
}

export function resolveDecisionControlConfig(settings: unknown = {}, env: NodeJS.ProcessEnv = process.env): DecisionControlConfig {
  const root = settings && typeof settings === 'object' ? settings as Record<string, unknown> : {}
  const agent = root.agent && typeof root.agent === 'object' ? root.agent as Record<string, unknown> : {}
  const control = agent.decision_control && typeof agent.decision_control === 'object' ? agent.decision_control as Record<string, unknown> : {}
  const backend = String(env.KATAZUKU_DECISION_BACKEND ?? control.backend ?? 'llm')
  if (!DECISION_BACKENDS.includes(backend as DecisionBackend)) throw new Error(`未知の判断backendです: ${backend}`)
  const numberSetting = (envName: string, key: string, fallback: number) => asProbability(Number(env[envName] ?? control[key] ?? fallback), key)
  const config: DecisionControlConfig = {
    backend: backend as DecisionBackend,
    minConfidence: numberSetting('KATAZUKU_DECISION_MIN_CONFIDENCE', 'min_confidence', 0.65),
    autonomousThreshold: numberSetting('KATAZUKU_DECISION_AUTO_THRESHOLD', 'autonomous_threshold', 0.85),
    jevModel: String(env.TYPESAFE_DEFAULT_MODEL ?? control.jev_model ?? 'jev-latest'),
  }
  if (config.autonomousThreshold < 0.5) throw new Error('autonomous_thresholdは0.5以上にしてください')
  if (config.backend === 'jev' && !env.TYPESAFE_API_KEY?.trim()) throw new Error('JevにはTYPESAFE_API_KEYが必要です')
  return config
}

export class LlmAtomicDecisionEvaluator implements AtomicDecisionEvaluator {
  constructor(private readonly run: (prompt: string) => Promise<string>) {}
  async evaluate(request: AtomicDecisionRequest): Promise<AtomicDecisionResult> { return parseLlmDecisionResult(await this.run(renderLlmDecisionPrompt(request)), request) }
}

/** TypeSafe SDKへ依存せず、公開REST APIへ接続する任意adapter。 */
export class TypeSafeJevDecisionEvaluator implements AtomicDecisionEvaluator {
  constructor(private readonly options: { apiKey: string; model?: string; baseUrl?: string; fetch?: typeof globalThis.fetch }) {
    if (!options.apiKey.trim()) throw new Error('JevにはAPIキーが必要です')
  }
  async evaluate(request: AtomicDecisionRequest): Promise<AtomicDecisionResult> {
    validateAtomicDecisionRequest(request)
    const fetchImpl = this.options.fetch ?? globalThis.fetch
    const questions = Object.fromEntries(Object.entries(request.questions).map(([id, question]) => [id, { ...question, type: question.type === 'boolean' ? 'noul' : question.type }]))
    const response = await fetchImpl(`${(this.options.baseUrl ?? 'https://api.typesafe.ai').replace(/\/$/, '')}/v1/systemone`, {
      method: 'POST', headers: { Authorization: `Bearer ${this.options.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.options.model ?? 'jev-latest', state: request.state, questions }),
    })
    if (!response.ok) throw new Error(`Jev APIが失敗しました: HTTP ${response.status}`)
    const payload = await response.json() as { model?: string; answers?: Record<string, Record<string, unknown>> }
    if (!payload.answers || typeof payload.model !== 'string') throw new Error('Jev API応答が不正です')
    const answers = Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
      const raw = payload.answers![id]
      if (!raw) throw new Error(`Jev API応答に${id}がありません`)
      return [id, validateAnswer(id, question, question.type === 'boolean' ? { type: 'boolean', probability: raw.noul } : raw)]
    }))
    return { schemaVersion: 1, backend: 'jev', model: payload.model, answers }
  }
}
