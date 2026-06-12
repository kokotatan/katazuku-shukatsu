import type { Category } from '../types'

/**
 * 「自分が乗っている選考の連絡」なのか、それ以外なのかを判定する。
 *
 * - selection:  進行中の選考に関する連絡(面接・結果・提出依頼・日程調整)
 * - recruiting: 企業からの募集・説明会の案内(まだ選考に乗っていない)
 * - promo:      就活サービス(ナビサイト・スカウト媒体)の宣伝・メルマガ
 * - other:      就活と関係ないメール(Slack通知など)
 */
export type SelectionKind = 'selection' | 'recruiting' | 'promo' | 'other'

// 就活プラットフォーム・スカウト媒体のドメイン(企業の採用ATSは含めない)
const PLATFORM_DOMAIN_RE =
  /goodfind|slogan\.jp|typeshukatsu|bizreach|br-campus|en-?courage|labbase|openwork|gaishishukatsu|gakujo|re-katsu|offerbox|mynavi|rikunabi|onecareer|unistyle|careerpark|kimisuka|wantedly|athletics|irodas|abuild|ibeck/i

// 宣伝・メルマガらしさ
const PROMO_RE =
  /メールマガジン|メルマガ|配信停止|購読解除|おすすめ(の|求人|企業)|ニュースレター|キャンペーン|アマギフ|Amazonギフト|ギフト券|プレゼント|限定案内|特集|スカウトが届|興味を持って/

// 就活の話題か(otherとの切り分け用)
const SHUKATSU_RE = /選考|採用|インターン|エントリー|説明会|新卒|就活|ES|面接|面談|内定|卒|キャリア/

export function detectSelectionKind(
  fromAddress: string,
  subject: string,
  body: string,
  category: Category,
): SelectionKind {
  const domain = fromAddress.split('@')[1] ?? ''
  const text = `${subject}\n${body}`

  // ナビサイト・スカウト媒体からのメールは、内容が面接や締切でも「選考」ではない
  if (PLATFORM_DOMAIN_RE.test(domain)) return 'promo'

  if (!SHUKATSU_RE.test(text)) return 'other'

  if (PROMO_RE.test(text) && category === 'other') return 'promo'

  // 企業からの連絡: 選考プロセス(結果・面接・提出物)はselection、イベント告知はrecruiting
  switch (category) {
    case 'result':
    case 'interview':
    case 'task':
      return 'selection'
    case 'event':
      return 'recruiting'
    default:
      return PROMO_RE.test(text) ? 'promo' : 'recruiting'
  }
}

export const SELECTION_META: Record<
  SelectionKind,
  { label: string; icon: string; color: string }
> = {
  selection: { label: '選考', icon: '🎯', color: 'bg-violet-600 text-white' },
  recruiting: { label: '募集案内', icon: '📣', color: 'bg-sky-100 text-sky-700' },
  promo: { label: '宣伝', icon: '📰', color: 'bg-slate-200 text-slate-500' },
  other: { label: '対象外', icon: '・', color: 'bg-slate-100 text-slate-400' },
}
