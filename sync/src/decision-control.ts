export const DECISION_BACKENDS = ['llm', 'jev', 'off'] as const
export type DecisionBackend = typeof DECISION_BACKENDS[number]
export type DecisionValue = string | number | boolean | null | DecisionValue[] | { [key: string]: DecisionValue }

export type AtomicDecisionQuestion =
  | { type: 'boolean'; instructions: string; criteria?: { true?: DecisionValue; false?: DecisionValue } }
  | { type: 'choice'; instructions: string; criteria: Record<string, DecisionValue> }
  | { type: 'score'; instructions: string; criteria: [DecisionValue, DecisionValue, ...DecisionValue[]] }

export interface AtomicDecisionRequest {
  state: DecisionValue
  questions: Record<string, AtomicDecisionQuestion>
}

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

export interface DecisionControlPolicy {
  minConfidence: number
  autonomousThreshold: number
}

export interface DecisionControlConfig extends DecisionControlPolicy {
  backend: DecisionBackend
  jevModel: string
}

export interface AtomicDecisionEvaluator {
  evaluate(request: AtomicDecisionRequest): Promise<AtomicDecisionResult>
}

export const DEFAULT_DECISION_POLICY: DecisionControlPolicy = {
  minConfidence: 0.65,
  autonomousThreshold: 0.85,
}

function probability(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label}は0以上1以下の数値である必要があります`)
  }
  return value
}

function exactKeys(value: Record<string, unknown>, allowed: string[], label: string): void {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key))
  if (extras.length) throw new Error(`${label}に未知の項目があります: ${extras.join(', ')}`)
}

export function validateAtomicDecisionRequest(request: AtomicDecisionRequest): void {
  if (!request || typeof request !== 'object' || !request.questions || typeof request.questions !== 'object') {
    throw new Error('判断requestが不正です')
  }
  const entries = Object.entries(request.questions)
  if (!entries.length) throw new Error('原子的な質問を1件以上指定してください')
  for (const [id, question] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id)) throw new Error(`質問IDが不正です: ${id}`)
    if (!question.instructions.trim()) throw new Error(`${id}: instructionsは必須です`)
    if (question.type === 'choice' && Object.keys(question.criteria).length < 2) {
      throw new Error(`${id}: choiceには2つ以上の候補が必要です`)
    }
    if (question.type === 'score' && question.criteria.length < 2) {
      throw new Error(`${id}: scoreには2段階以上の基準が必要です`)
    }
  }
}

/**
 * Jev型の判断を通常LLMへ要求するプロンプト。文章生成・行動計画をさせず、
 * 独立した原子的質問と確率だけに出力を制限する。
 */
export function renderLlmDecisionPrompt(request: AtomicDecisionRequest): string {
  validateAtomicDecisionRequest(request)
  return [
    'あなたは文章生成ではなく、機械が利用する原子的な判断だけを行います。',
    '各質問は他の質問から独立に、stateだけを根拠に評価してください。',
    '不足情報を補完せず、行動・説明・提案・自由記述を生成しないでください。',
    'JSON以外を出力せず、確率とconfidenceは0以上1以下にしてください。',
    'booleanはtrueである確率、choiceは全候補の確率、scoreは各段階の確率を返します。',
    '',
    JSON.stringify({
      output: {
        schemaVersion: 1,
        backend: 'llm',
        model: '実際に使用したモデル名',
        answers: {
          '<questionId>': {
            type: 'boolean | choice | score',
            probability: 'booleanの場合のみ',
            choice: 'choiceの場合のみ',
            score: 'scoreの場合のみ',
            confidence: 'choice/scoreの場合のみ',
            probabilities: 'choice/scoreの場合のみ。候補ごとの0..1',
          },
        },
      },
      request,
    }, null, 2),
  ].join('\n')
}

export function parseLlmDecisionResult(text: string, request: AtomicDecisionRequest): AtomicDecisionResult {
  validateAtomicDecisionRequest(request)
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) throw new Error('LLM判断はJSONオブジェクト1つだけで返してください')
  const value = JSON.parse(trimmed) as Record<string, unknown>
  exactKeys(value, ['schemaVersion', 'backend', 'model', 'answers'], '判断結果')
  if (value.schemaVersion !== 1 || value.backend !== 'llm' || typeof value.model !== 'string' || !value.model) {
    throw new Error('LLM判断のschemaVersion/backend/modelが不正です')
  }
  if (!value.answers || typeof value.answers !== 'object' || Array.isArray(value.answers)) throw new Error('answersが不正です')
  const rawAnswers = value.answers as Record<string, unknown>
  const expectedIds = Object.keys(request.questions).sort()
  const actualIds = Object.keys(rawAnswers).sort()
  if (JSON.stringify(expectedIds) !== JSON.stringify(actualIds)) throw new Error('質問IDと回答IDが一致しません')
  const answers: Record<string, AtomicDecisionAnswer> = {}
  for (const id of expectedIds) {
    const question = request.questions[id]
    const raw = rawAnswers[id]
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${id}: 回答が不正です`)
    const answer = raw as Record<string, unknown>
    if (answer.type !== question.type) throw new Error(`${id}: 質問と回答の型が一致しません`)
    if (question.type === 'boolean') {
      exactKeys(answer, ['type', 'probability'], id)
      answers[id] = { type: 'boolean', probability: probability(answer.probability, `${id}.probability`) }
      continue
    }
    if (!answer.probabilities || typeof answer.probabilities !== 'object' || Array.isArray(answer.probabilities)) {
      throw new Error(`${id}: probabilitiesが不正です`)
    }
    const probabilities = Object.fromEntries(Object.entries(answer.probabilities as Record<string, unknown>)
      .map(([key, item]) => [key, probability(item, `${id}.probabilities.${key}`)]))
    if (question.type === 'choice') {
      exactKeys(answer, ['type', 'choice', 'confidence', 'probabilities'], id)
      if (typeof answer.choice !== 'string' || !Object.hasOwn(question.criteria, answer.choice)) throw new Error(`${id}: choiceが候補外です`)
      const expected = Object.keys(question.criteria).sort()
      if (JSON.stringify(Object.keys(probabilities).sort()) !== JSON.stringify(expected)) throw new Error(`${id}: choiceの確率キーが候補と一致しません`)
      answers[id] = { type: 'choice', choice: answer.choice, confidence: probability(answer.confidence, `${id}.confidence`), probabilities }
    } else {
      exactKeys(answer, ['type', 'score', 'confidence', 'probabilities'], id)
      if (typeof answer.score !== 'number' || !Number.isFinite(answer.score) || answer.score < 0 || answer.score > question.criteria.length - 1) {
        throw new Error(`${id}: scoreが範囲外です`)
      }
      answers[id] = { type: 'score', score: answer.score, confidence: probability(answer.confidence, `${id}.confidence`), probabilities }
    }
  }
  return { schemaVersion: 1, backend: 'llm', model: value.model, answers }
}

export function routeAtomicDecision(answer: AtomicDecisionAnswer, policy: DecisionControlPolicy = DEFAULT_DECISION_POLICY): {
  status: 'decided' | 'review'
  certainty: number
  reason: string
} {
  probability(policy.minConfidence, 'minConfidence')
  probability(policy.autonomousThreshold, 'autonomousThreshold')
  if (policy.autonomousThreshold < 0.5) throw new Error('autonomousThresholdは0.5以上にしてください')
  const certainty = answer.type === 'boolean'
    ? Math.max(answer.probability, 1 - answer.probability)
    : answer.confidence
  if (certainty < policy.minConfidence) return { status: 'review', certainty, reason: '確信度が最低基準未満' }
  if (certainty < policy.autonomousThreshold) return { status: 'review', certainty, reason: '自動判断の閾値未満' }
  return { status: 'decided', certainty, reason: '自動判断の閾値を満たす' }
}

export function routeDecisionResult(result: AtomicDecisionResult, policy: DecisionControlPolicy = DEFAULT_DECISION_POLICY) {
  return Object.fromEntries(Object.entries(result.answers).map(([id, answer]) => [id, routeAtomicDecision(answer, policy)]))
}

export function resolveDecisionControlConfig(
  settings: unknown = {},
  env: NodeJS.ProcessEnv = process.env,
): DecisionControlConfig {
  const root = settings && typeof settings === 'object' ? settings as Record<string, unknown> : {}
  const agent = root.agent && typeof root.agent === 'object' ? root.agent as Record<string, unknown> : {}
  const control = agent.decision_control && typeof agent.decision_control === 'object'
    ? agent.decision_control as Record<string, unknown> : {}
  const requested = String(env.KATAZUKU_DECISION_BACKEND ?? control.backend ?? 'llm')
  if (!DECISION_BACKENDS.includes(requested as DecisionBackend)) throw new Error(`未知の判断backendです: ${requested}`)
  const numeric = (envName: string, settingName: string, fallback: number) => {
    const raw = env[envName] ?? control[settingName] ?? fallback
    const value = Number(raw)
    probability(value, settingName)
    return value
  }
  const config: DecisionControlConfig = {
    backend: requested as DecisionBackend,
    minConfidence: numeric('KATAZUKU_DECISION_MIN_CONFIDENCE', 'min_confidence', 0.65),
    autonomousThreshold: numeric('KATAZUKU_DECISION_AUTO_THRESHOLD', 'autonomous_threshold', 0.85),
    jevModel: String(env.TYPESAFE_DEFAULT_MODEL ?? control.jev_model ?? 'jev-latest'),
  }
  if (config.autonomousThreshold < 0.5) throw new Error('autonomous_thresholdは0.5以上にしてください')
  if (config.backend === 'jev' && !env.TYPESAFE_API_KEY?.trim()) {
    throw new Error('Jevを使うにはTYPESAFE_API_KEYを端末の環境変数またはOS keychainへ設定してください')
  }
  return config
}

export class LlmAtomicDecisionEvaluator implements AtomicDecisionEvaluator {
  constructor(private readonly run: (prompt: string) => Promise<string>) {}

  async evaluate(request: AtomicDecisionRequest): Promise<AtomicDecisionResult> {
    return parseLlmDecisionResult(await this.run(renderLlmDecisionPrompt(request)), request)
  }
}
