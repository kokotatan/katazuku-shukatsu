/**
 * 「何をすればいいのか」(具体的なやることリスト)と
 * 「どこでやるのか」(フォーム・マイページのURL)を本文から抽出する。
 */

export interface ActionPlan {
  /** 「日程を選んで回答」「ESを提出」のような具体的なやること */
  steps: string[]
  /** アクションを実行するフォーム・マイページ等のURL */
  url: string | null
}

// 上から順に評価し、マッチしたものを全部やることリストに入れる
const STEP_RULES: { re: RegExp; step: string }[] = [
  { re: /候補日|日程.{0,10}(選択|登録|入力|回答|予約|調整)|ご都合.{0,10}(回答|お知らせ|教え)/, step: '日程を選んで回答' },
  { re: /(エントリーシート|ES).{0,15}(提出|ご?入力|ご?記入|作成)/, step: 'ESを提出' },
  { re: /(技術)?課題.{0,15}(提出|ご?提出|提出期限|に取り組)/, step: '課題を提出' },
  { re: /履歴書.{0,15}(提出|アップロード|ご?用意)/, step: '履歴書を提出' },
  { re: /研究概要.{0,15}(提出|ご?用意|アップロード)/, step: '研究概要を提出' },
  { re: /(SPI|玉手箱|TG-?WEB|Webテスト|WEBテスト|適性検査|テストセンター).{0,25}(受検|受験|回答|実施)/, step: '適性検査を受検' },
  { re: /(受検|ご?受験).{0,10}(お願い|ください|期限)/, step: '適性検査を受検' },
  { re: /(説明会|セミナー|イベント|座談会|面談|ワークショップ|オープン・?カンパニー).{0,20}(予約|お?申し?込み|エントリー)/, step: 'イベントを予約' },
  { re: /アンケート.{0,15}(回答|ご?協力|入力)/, step: 'アンケートに回答' },
  { re: /(本|プレ)?エントリー.{0,10}(フォーム|手続|をお願い|受付)/, step: 'エントリー手続き' },
  { re: /ご?返信.{0,10}(ください|お願い|お待ち)/, step: 'メールに返信' },
  { re: /書類.{0,10}(提出|アップロード)/, step: '書類を提出' },
]

// アクションの実行先らしさを判定する語(URL前後の文脈とURL自体の両方を見る)
const ACTION_CONTEXT_RE =
  /予約|回答|提出|選択|エントリー|フォーム|マイページ|受検|受験|お?申し?込み|登録|ログイン|こちら/
const ACTION_URL_RE = /mypage|my-page|entry|form|reserve|apply|recruit|saiyo|sonar|i-web|career|webentry/i
const NOISE_URL_RE = /unsubscribe|optout|opt-out|mailmag|配信停止|stop|cancel_mail|notification/i

const URL_RE = /https?:\/\/[^\s<>"'」』）)\]】]+/g

export function extractActionPlan(body: string): ActionPlan {
  const steps: string[] = []
  for (const rule of STEP_RULES) {
    if (rule.re.test(body) && !steps.includes(rule.step)) steps.push(rule.step)
  }

  let best: { url: string; score: number } | null = null
  for (const m of body.matchAll(URL_RE)) {
    const url = m.toString().replace(/[.,。、]+$/, '')
    if (NOISE_URL_RE.test(url)) continue
    // 「ご予約はこちら → URL」のように直前にアクション語があるものを最優先
    const before = body.slice(Math.max(0, m.index! - 120), m.index!)
    const after = body.slice(m.index! + url.length, m.index! + url.length + 60)
    let score = 0
    if (ACTION_CONTEXT_RE.test(before)) score += 3
    if (ACTION_URL_RE.test(url)) score += 2
    if (ACTION_CONTEXT_RE.test(after)) score += 1
    if (best === null || score > best.score) best = { url, score }
  }

  return { steps, url: best && best.score > 0 ? best.url : null }
}
