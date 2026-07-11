import type { Category, Email, RawEmail } from '../types'
import { extractActionPlan } from './actions'
import { extractDates, formatDateShort, pickDeadline } from './dates'
import { detectSelectionKind } from './selection'

// 上から順に評価。「選考結果」は「面接」より語が重なるため先に置く
const CATEGORY_RULES: { category: Category; re: RegExp }[] = [
  {
    category: 'result',
    re: /選考結果|合否|内々定|内定(?!者)|通過のご連絡|お見送り|不合格|残念ながら|採用のご連絡/,
  },
  {
    category: 'interview',
    re: /面接|面談|日程調整|日程のご?(案内|調整|確認)|候補日|リクルーター|一次選考|二次選考|最終選考|カジュアル面談/,
  },
  {
    category: 'task',
    re: /エントリーシート|ES|課題(?!解決)|提出|書類選考に進むため|アンケート|応募手続|事前(準備|案内|タスク)|キックオフ|セットアップ|持ち物|宿泊|交通費/,
  },
  {
    category: 'test',
    re: /Webテスト|WEBテスト|適性検査|SPI|玉手箱|TG-?WEB|eF-1G|テストセンター|受検|受験のお願い|新卒検定/,
  },
  {
    category: 'event',
    re: /説明会|セミナー|インターン|イベント|座談会|ワークショップ|オープン・?カンパニー|キャリアフェア|交流会/,
  },
]

const ACTION_RE =
  /ご?返信|ご?回答|日程.{0,10}(調整|登録|選択|入力|予約)|候補日.{0,10}(お知らせ|ご連絡|入力|選択)|ご?提出|受検|ご?受験|ご?予約|お申し?込み|出欠|ご都合|お手続き|ご連絡(を?お待ち|ください)|再調整|エントリー(をお願い|フォーム)|セットアップ|参加登録|Slack.{0,15}(招待|参加)|事前(準備|課題|タスク|アンケート)/

const NOISE_RE =
  /メールマガジン|メルマガ|配信停止|購読解除|おすすめ(の|求人|企業)|ニュースレター|キャンペーン/

const ACTION_VERB: Record<Category, string> = {
  interview: '日程を回答',
  result: '内容を確認して手続き',
  task: '提出',
  test: '受検',
  event: '申し込み',
  other: '対応',
}

function detectCategory(subject: string, body: string): Category {
  for (const rule of CATEGORY_RULES) {
    if (rule.re.test(subject)) return rule.category
  }
  for (const rule of CATEGORY_RULES) {
    if (rule.re.test(body)) return rule.category
  }
  return 'other'
}

/** 差出人表示名・本文署名から会社名を推定する */
export function extractCompany(from: string, fromAddress: string, body: string): string {
  const COMPANY_RE = /(株式会社|合同会社|有限会社)[^\s、。()（）\n]{1,20}|[^\s、。()（）\n]{2,20}(株式会社|ホールディングス|銀行|証券|生命|損保)/
  const fromMatch = from.match(COMPANY_RE)
  if (fromMatch) return fromMatch[0]
  // 表示名から「採用担当」「人事部」などを除いた残りを使う
  const cleaned = from
    .replace(
      /新卒採用(担当|チーム|事務局|セミナー事務局|G)?|採用(担当|チーム|事務局|グループ|責任者)?|(人事|HR)本部?|人事部?|インターンシップ(担当|事務局)?|キャリアイベント|運営事務局|事務局|広報/g,
      '',
    )
    .replace(/[\s<>"']/g, '')
  if (cleaned.length >= 2) return cleaned
  const bodyMatch = body.match(COMPANY_RE)
  if (bodyMatch) return bodyMatch[0]
  const domain = fromAddress.split('@')[1] ?? ''
  return domain.split('.')[0] || from
}

/** 生メールを分類・締切抽出して Email に変換する */
export function classifyEmail(raw: RawEmail, now: Date = new Date()): Email {
  const text = `${raw.subject}\n${raw.body}`
  const isNoise = NOISE_RE.test(text)
  const category = isNoise ? 'other' : detectCategory(raw.subject, raw.body)

  const picked = pickDeadline(extractDates(raw.body, new Date(raw.receivedAt)), now)
  const selectionKind = detectSelectionKind(raw.fromAddress, raw.subject, raw.body, category)
  // 〆切が生きているメールは、アクション語がなくても要対応として浮かせる。
  // ただしナビ媒体等の宣伝(promo)と就活外(other)は、締切があっても要対応に積まない(精度優先)
  const relevant = selectionKind !== 'promo' && selectionKind !== 'other'
  const needsAction = !isNoise && relevant && (ACTION_RE.test(text) || picked?.kind === 'deadline')

  let actionHint: string | null = null
  if (picked) {
    const when = formatDateShort(picked.date, picked.hasTime)
    actionHint =
      picked.kind === 'deadline'
        ? `${when} までに${ACTION_VERB[category]}`
        : `${when} ${category === 'interview' ? '面接' : '開催'}`
  } else if (needsAction) {
    actionHint = `${ACTION_VERB[category]}が必要`
  }

  const plan = needsAction ? extractActionPlan(raw.body) : { steps: [], url: null }

  return {
    ...raw,
    company: extractCompany(raw.from, raw.fromAddress, raw.body),
    category,
    selectionKind,
    deadline: picked ? picked.date.toISOString() : null,
    deadlineKind: picked?.kind ?? null,
    needsAction,
    actionHint,
    actionSteps: plan.steps,
    actionUrl: plan.url,
    status: 'inbox',
    snoozeUntil: null,
    doneAt: null,
  }
}
