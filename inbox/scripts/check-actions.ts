/**
 * アクション抽出(lib/actions.ts)の動作チェック。
 * 実行: cd inbox && npx tsx scripts/check-actions.ts
 */
import { extractActionPlan } from '../src/lib/actions'

let failed = 0
function check(label: string, cond: boolean, detail = '') {
  console.log(`${cond ? '✅' : '❌'} ${label}${cond ? '' : ` — ${detail}`}`)
  if (!cond) failed++
}

// 1. 日程回答+フォームURL
let p = extractActionPlan(
  `面談の候補日を下記URLよりご選択ください。\nhttps://mypage.example-recruit.jp/form/12345\nご都合が合わない場合はご返信ください。`,
)
check('日程回答を検出', p.steps.includes('日程を選んで回答'))
check('返信も検出', p.steps.includes('メールに返信'))
check('フォームURLを拾う', p.url === 'https://mypage.example-recruit.jp/form/12345')

// 2. ES+適性検査
p = extractActionPlan(
  `エントリーシートのご提出と、SPIの受検をお願いいたします。期限は6/25(木)12:00です。\n提出はこちら → https://job.example.com/entry`,
)
check('ES提出を検出', p.steps.includes('ESを提出'))
check('適性検査を検出', p.steps.includes('適性検査を受検'))
check('entry系URLを拾う', p.url === 'https://job.example.com/entry')

// 3. 配信停止URLしかないメールはURLなし扱い
p = extractActionPlan(
  `おすすめ求人のお知らせです。\n配信停止はこちら https://example.com/unsubscribe?id=999`,
)
check('配信停止URLは拾わない', p.url === null)

// 4. アクション語の近くにあるURLを優先する
p = extractActionPlan(
  `会社案内: https://corp.example.com/about\n\n説明会のご予約はこちらから\nhttps://seminar.example.com/x9y8z7`,
)
check('イベント予約を検出', p.steps.includes('イベントを予約'))
check('予約文脈のURLを優先', p.url === 'https://seminar.example.com/x9y8z7')

// 5. アクション語ゼロの告知メール
p = extractActionPlan('新しいオフィスに移転しました。今後ともよろしくお願いいたします。')
check('やることなし', p.steps.length === 0 && p.url === null)

if (failed) {
  console.error(`\n${failed}件失敗`)
  process.exit(1)
}
console.log('\nすべて通過 🎉')
