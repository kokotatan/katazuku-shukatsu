// 要対応(needsAction)の精度検証: 宣伝・就活外メールは締切があっても要対応に積まない
import { classifyEmail } from '../src/lib/classify'
import type { RawEmail } from '../src/types'

let failed = 0
function assert(name: string, cond: boolean) {
  if (cond) console.log(`[OK] ${name}`)
  else {
    console.error(`[NG] ${name}`)
    failed++
  }
}

const NOW = new Date('2026-07-10T12:00:00+09:00')

function raw(over: Partial<RawEmail>): RawEmail {
  return {
    id: 'test',
    from: 'テスト株式会社 採用担当',
    fromAddress: 'recruit@example.co.jp',
    subject: '',
    body: '',
    receivedAt: '2026-07-10T09:00:00+09:00',
    source: 'import',
    ...over,
  }
}

// 1. ナビ媒体(promo)は締切付きでも要対応にしない
const promo = classifyEmail(
  raw({
    fromAddress: 'info@gaishishukatsu.com',
    subject: '【本日締切】インターン/本選考まとめ',
    body: '新卒の選考情報です。7/12(日) 23:59 までにエントリーをお願いします。',
  }),
  NOW,
)
assert('ナビ媒体の締切メールは promo 判定', promo.selectionKind === 'promo')
assert('ナビ媒体の締切メールは要対応にしない', !promo.needsAction)
assert('ナビ媒体でも締切自体は抽出する(あと何日表示用)', promo.deadline !== null)

// 2. 企業からの選考メールは従来どおり要対応
const selection = classifyEmail(
  raw({
    subject: '一次面接の日程調整のお願い',
    body: '選考について、7/13(月) 17:00 までに候補日をご回答ください。',
  }),
  NOW,
)
assert('企業の選考メールは selection 判定', selection.selectionKind === 'selection')
assert('企業の選考メールは要対応', selection.needsAction)

// 3. 企業からの募集案内(recruiting)は締切があれば要対応のまま
const recruiting = classifyEmail(
  raw({
    subject: 'サマーインターンシップ説明会のご案内',
    body: '新卒採用のイベントです。7/14(火) までにお申し込みください。',
  }),
  NOW,
)
assert('企業の募集案内は recruiting 判定', recruiting.selectionKind === 'recruiting')
assert('企業の募集案内(締切あり)は要対応を維持', recruiting.needsAction)

// 4. 課外活動(activity)も要対応を維持(海外渡航・ハッカソン等は本人が追うもの)
const activity = classifyEmail(
  raw({
    fromAddress: 'info@example-hack.jp',
    subject: 'ハッカソン参加登録のご案内',
    body: 'ハッカソンのエントリーフォームはこちら。7/20(月) までに参加登録をお願いします。',
  }),
  NOW,
)
assert('就活文脈のないハッカソンは activity 判定', activity.selectionKind === 'activity')
assert('課外活動(締切あり)は要対応を維持', activity.needsAction)

// 5. 就活と無関係のメール(other)は要対応にしない
const other = classifyEmail(
  raw({
    from: 'カードサービス',
    fromAddress: 'news@card.example.com',
    subject: 'ご利用明細のお知らせ',
    body: 'お支払いについて 7/15(水) までにご回答ください。',
  }),
  NOW,
)
assert('就活と無関係のメールは other 判定', other.selectionKind === 'other')
assert('就活と無関係のメールは要対応にしない', !other.needsAction)

if (failed > 0) {
  console.error(`\n${failed}件失敗`)
  process.exit(1)
}
console.log('\nすべて通過')
