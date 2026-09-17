import { TypeSafeClient, choice, noul } from '@typesafe-ai/sdk'

export const JEV_MODEL = 'jev-latest'

export const JEV_MAIL_CATEGORIES = [
  'scheduling',
  'submission',
  'interview',
  'selection_result',
  'information',
  'irrelevant',
  'other',
] as const

export type JevMailCategory = typeof JEV_MAIL_CATEGORIES[number]

export interface JevMailCandidate {
  id: string
  subject: string
  sender?: string
  summary?: string
  category?: string
  needsAction?: boolean
  deadline?: string
  company?: string
  position?: string
}

export interface JevMailState {
  subject: string
  senderDomain?: string
  summary?: string
  extractedCategory?: string
  extractedNeedsAction?: boolean
  deadline?: string
  company?: string
  position?: string
}

export interface JevMailJudgment {
  model: string
  category: JevMailCategory
  categoryConfidence: number
  probabilities: Record<string, number>
  recruitingRelevance: number
  needsAction: number
  timeSensitive: number
  inputTokens: number
  outputTokens: number
}

export interface JevMailEvaluator {
  evaluate(state: JevMailState): Promise<JevMailJudgment>
}

export interface JevMailAssessment extends JevMailJudgment {
  id: string
  route: 'keep' | 'review'
  reasons: string[]
}

export interface JevDailySyncAssessment {
  schemaVersion: 1
  generatedAt: string
  provider: 'typesafe-ai'
  model: string
  policy: 'advisory-only'
  items: JevMailAssessment[]
  usage: { inputTokens: number; outputTokens: number }
}

const categoryCriteria = {
  scheduling: '面接、面談、説明会、イベントの日程候補・予約・変更・取消',
  submission: 'ES、適性検査、証明書、誓約書、アンケートなど期限付き提出物',
  interview: '面接・面談の案内、準備、参加方法、選考中の連絡',
  selection_result: '合格、不合格、内定、次選考への通過などの選考結果',
  information: '就活に関係するが、本人の対応を直ちに必要としない案内',
  irrelevant: '就活自動化の対象外、広告、ニュースレター、無関係な通知',
  other: '上記のどれにも明確に当てはまらない',
} as const

/**
 * TypeSafe AI公式SDKを使う薄いアダプター。
 * Jevにはメール本文や個人メールアドレスを渡さず、抽出済み最小情報だけを送る。
 */
export class TypeSafeJevMailEvaluator implements JevMailEvaluator {
  constructor(private readonly client = new TypeSafeClient({ defaultModel: JEV_MODEL })) {}

  async evaluate(state: JevMailState): Promise<JevMailJudgment> {
    const response = await this.client.systemOne({
      model: JEV_MODEL,
      state,
      questions: {
        category: choice('このメールの主目的を1つ選ぶ', categoryCriteria),
        recruitingRelevance: noul('このメールは本人の就職活動の管理対象か'),
        needsAction: noul('このメールに対して本人またはkatazukuの具体的な対応が必要か'),
        timeSensitive: noul('期限・予約枠・開始時刻などのため早急な確認が必要か'),
      },
    })
    return {
      model: response.model,
      category: response.answers.category.choice,
      categoryConfidence: response.answers.category.confidence,
      probabilities: { ...response.answers.category.probabilities },
      recruitingRelevance: response.answers.recruitingRelevance.noul,
      needsAction: response.answers.needsAction.noul,
      timeSensitive: response.answers.timeSensitive.noul,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    }
  }
}

function senderDomain(sender?: string): string | undefined {
  if (!sender) return undefined
  const match = sender.match(/@([^>\s]+)/)
  return match?.[1]?.toLowerCase()
}

/** 外部送信するstate。id、sourceRef、メールアドレスのlocal-part、本文は含めない。 */
export function toJevMailState(mail: JevMailCandidate): JevMailState {
  return {
    subject: mail.subject,
    senderDomain: senderDomain(mail.sender),
    summary: mail.summary,
    extractedCategory: mail.category,
    extractedNeedsAction: mail.needsAction,
    deadline: mail.deadline,
    company: mail.company,
    position: mail.position,
  }
}

function normalizedExistingCategory(value?: string): JevMailCategory | undefined {
  const text = (value ?? '').toLowerCase()
  if (!text) return undefined
  if (/日程|予約|schedule|appointment/.test(text)) return 'scheduling'
  if (/提出|課題|es|assessment|適性|survey|誓約|証明/.test(text)) return 'submission'
  if (/面接|面談|interview/.test(text)) return 'interview'
  if (/結果|合格|不合格|内定|通過|rejected|offer|result/.test(text)) return 'selection_result'
  if (/広告|無関係|irrelevant|newsletter/.test(text)) return 'irrelevant'
  if (/案内|情報|information|notice/.test(text)) return 'information'
  return undefined
}

/**
 * Jevは安全規則を上書きしない。強い不一致・高優先度・低確信だけをreviewへ送る。
 * keepは「既存抽出を維持」の意味であり、Jevの判断で自動破棄する意味ではない。
 */
export function routeJevAssessment(mail: JevMailCandidate, judgment: JevMailJudgment): {
  route: 'keep' | 'review'
  reasons: string[]
} {
  const reasons: string[] = []
  if (judgment.categoryConfidence < 0.65) reasons.push('Jevのカテゴリ確信度が低い')
  if (judgment.timeSensitive >= 0.85) reasons.push('期限・予約・開始時刻に関する可能性が高い')
  if (judgment.recruitingRelevance >= 0.85 && judgment.needsAction >= 0.85) {
    reasons.push('就活関連かつ対応必要の可能性が高い')
  }

  const existingCategory = normalizedExistingCategory(mail.category)
  if (existingCategory && existingCategory !== judgment.category && judgment.categoryConfidence >= 0.8) {
    reasons.push(`既存カテゴリ(${existingCategory})とJev(${judgment.category})が強く不一致`)
  }
  if (mail.needsAction === true && judgment.needsAction <= 0.2) {
    reasons.push('既存の要対応判定とJevが強く不一致')
  }
  if (mail.needsAction === false && judgment.needsAction >= 0.8) {
    reasons.push('既存の対応不要判定とJevが強く不一致')
  }
  return { route: reasons.length ? 'review' : 'keep', reasons }
}

export async function assessDailySyncMails(
  mails: JevMailCandidate[],
  evaluator: JevMailEvaluator,
  options: { concurrency?: number; now?: Date } = {},
): Promise<JevDailySyncAssessment> {
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 4, 16))
  const items = new Array<JevMailAssessment>(mails.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, mails.length) }, async () => {
    while (true) {
      const index = cursor++
      if (index >= mails.length) return
      const mail = mails[index]
      const judgment = await evaluator.evaluate(toJevMailState(mail))
      const routed = routeJevAssessment(mail, judgment)
      items[index] = { id: mail.id, ...judgment, ...routed }
    }
  })
  await Promise.all(workers)
  return {
    schemaVersion: 1,
    generatedAt: (options.now ?? new Date()).toISOString(),
    provider: 'typesafe-ai',
    model: items[0]?.model ?? JEV_MODEL,
    policy: 'advisory-only',
    items,
    usage: {
      inputTokens: items.reduce((sum, item) => sum + item.inputTokens, 0),
      outputTokens: items.reduce((sum, item) => sum + item.outputTokens, 0),
    },
  }
}
