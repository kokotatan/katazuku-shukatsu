import type { Category } from '../types'

/**
 * 「自分が乗っている選考の連絡」なのか、それ以外なのかを判定する。
 *
 * - selection:  進行中の選考に関する連絡(面接・結果・提出依頼・日程調整)
 * - recruiting: 企業からの募集・説明会の案内(まだ選考に乗っていない)
 * - activity:   就活以外の活動(海外渡航プログラム・ハッカソン・長期インターン等)
 * - promo:      就活サービス(ナビサイト・スカウト媒体)の宣伝・メルマガ
 * - other:      どれでもないメール(Slackのサインイン通知など)
 */
export type SelectionKind = 'selection' | 'recruiting' | 'activity' | 'promo' | 'other'

// 就活プラットフォーム・スカウト媒体のドメイン(企業の採用ATSは含めない)
const PLATFORM_DOMAIN_RE =
  /goodfind|slogan\.jp|typeshukatsu|bizreach|br-campus|en-?courage|labbase|openwork|gaishishukatsu|gakujo|re-katsu|offerbox|mynavi|rikunabi|onecareer|unistyle|careerpark|kimisuka|wantedly|athletics|irodas|abuild|ibeck/i

// 宣伝・メルマガらしさ
const PROMO_RE =
  /メールマガジン|メルマガ|配信停止|購読解除|おすすめ(の|求人|企業)|ニュースレター|キャンペーン|アマギフ|Amazonギフト|ギフト券|プレゼント|限定案内|特集|スカウトが届|興味を持って/

// 就活の話題か(otherとの切り分け用)
const SHUKATSU_RE = /選考|採用|インターン|エントリー|説明会|新卒|就活|ES|面接|面談|内定|卒|キャリア/

// 就活以外の活動(課外)らしさ
const ACTIVITY_RE =
  /海外渡航|渡航プログラム|留学|奨学金|ハッカソン|hackathon|アイデアソン|コンテスト|長期インターン|ボランティア|学会|研究会|起業/i

// 新卒就活の文脈(これがあれば課外ではなく選考側に倒す)
const NEW_GRAD_RE = /新卒|サマーインターン|本選考|内定|2[0-9]卒|採用担当|採用チーム/

export function detectSelectionKind(
  fromAddress: string,
  subject: string,
  body: string,
  category: Category,
): SelectionKind {
  const domain = fromAddress.split('@')[1] ?? ''
  const text = `${subject}\n${body}`

  // Slack通知: インターン・選考のワークスペース絡みなら選考の連絡として扱う(超重要)
  if (/slack\.com$/.test(domain)) {
    return SHUKATSU_RE.test(text) ? 'selection' : 'other'
  }

  // ナビサイト・スカウト媒体からのメールは、内容が面接や締切でも「選考」ではない
  if (PLATFORM_DOMAIN_RE.test(domain)) return 'promo'

  // 就活以外の活動(海外渡航・ハッカソン・長期インターン等)。新卒就活の文脈があれば選考側へ
  if (ACTIVITY_RE.test(text) && !NEW_GRAD_RE.test(text)) return 'activity'

  if (!SHUKATSU_RE.test(text)) return 'other'

  if (PROMO_RE.test(text) && category === 'other') return 'promo'

  // 企業からの連絡: 選考プロセス(結果・面接・提出物・適性検査)はselection、イベント告知はrecruiting
  switch (category) {
    case 'result':
    case 'interview':
    case 'task':
    case 'test':
      return 'selection'
    case 'event':
      return 'recruiting'
    default:
      return PROMO_RE.test(text) ? 'promo' : 'recruiting'
  }
}

export const SELECTION_META: Record<SelectionKind, { label: string; color: string }> = {
  selection: { label: '選考', color: 'bg-slate-900 text-white' },
  recruiting: { label: '募集案内', color: 'text-slate-500 ring-1 ring-slate-200' },
  activity: { label: '課外活動', color: 'text-slate-700 ring-1 ring-slate-400' },
  promo: { label: '宣伝', color: 'text-slate-400 ring-1 ring-slate-200' },
  other: { label: '対象外', color: 'text-slate-400 ring-1 ring-slate-200' },
}
