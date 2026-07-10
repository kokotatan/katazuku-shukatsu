/**
 * 返信文生成API(api/generate-reply.ts)のフォールバックテンプレートの動作チェック。
 * 実行: cd inbox && npx tsx scripts/check-reply-api.ts
 */
import { buildReplyTemplate, buildSalutation, promptFor } from '../../api/generate-reply'

let failed = 0
function check(label: string, cond: boolean) {
  console.log(`${cond ? '[OK]' : '[NG]'} ${label}`)
  if (!cond) failed++
}

const base = {
  from: '採用担当 山田',
  fromAddress: 'hr@example.com',
  company: 'テスト株式会社',
  subject: '一次面接の日程調整について',
  body: 'ご希望の日程をお知らせください。',
}

// 1. 宛名
check('宛名: 会社名あり', buildSalutation(base) === 'テスト株式会社\n採用ご担当者様')
check('宛名: 会社名なしでも成立', buildSalutation({}) === '採用ご担当者様')

// 2. interview: 日程候補を3つ、プレースホルダのまま提示
const interview = buildReplyTemplate({ ...base, category: 'interview' })
check(
  'interview: プレースホルダ日程が3つ',
  (interview.match(/・〇月〇日\(〇\) 00:00〜00:00/g) ?? []).length === 3,
)
check('interview: 日程確認の文言', interview.includes('ご都合はいかがでしょうか'))

// 3. test: 期日までに受検する旨
const test = buildReplyTemplate({ ...base, category: 'test' })
check('test: 受検する旨', test.includes('期日までに受検いたします'))

// 4. task: 対応する旨
const task = buildReplyTemplate({ ...base, category: 'task' })
check('task: 対応する旨', task.includes('期日までに対応いたします'))

// 5. result: 確認した旨
const result = buildReplyTemplate({ ...base, category: 'result' })
check('result: 確認した旨', result.includes('内容を確認いたしました'))

// 6. event / other / 不明カテゴリ: 汎用の確認返信
for (const category of ['event', 'other', '']) {
  const generic = buildReplyTemplate({ ...base, category })
  check(`${category || '(空)'}: 汎用返信が成立`, generic.includes('内容を確認いたしました'))
}

// 7. 全カテゴリ共通の骨格(宛名・冒頭・署名)
for (const category of ['interview', 'test', 'task', 'result', 'event', 'other']) {
  const text = buildReplyTemplate({ ...base, category })
  check(
    `${category}: 宛名・冒頭・署名を含む`,
    text.startsWith('テスト株式会社\n採用ご担当者様') &&
      text.includes('お世話になっております。東北大学大学院の奥山彪太郎です。') &&
      text.includes('okuyama.kotaro.career@gmail.com') &&
      text.includes('090-6746-0159'),
  )
}

// 8. 絵文字を含まない(監視範囲: 基本的な絵文字ブロック)
const emojiPattern = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u
check(
  'テンプレートに絵文字を含まない',
  ['interview', 'test', 'task', 'result', 'other'].every(
    (category) => !emojiPattern.test(buildReplyTemplate({ ...base, category })),
  ),
)

// 9. プロンプトには受信メールの情報が埋め込まれる
const prompt = promptFor(base)
check(
  'promptFor: 差出人・件名・本文を埋め込む',
  prompt.includes('採用担当 山田') &&
    prompt.includes('一次面接の日程調整について') &&
    prompt.includes('ご希望の日程をお知らせください。'),
)
check('promptFor: 署名を含む', prompt.includes('okuyama.kotaro.career@gmail.com'))

// 10. 欠損フィールドでも例外にならない
check('空オブジェクトでも生成できる', buildReplyTemplate({}).includes('奥山彪太郎'))

if (failed) {
  console.error(`\n${failed}件失敗`)
  process.exit(1)
}
console.log('\nすべて通過')
