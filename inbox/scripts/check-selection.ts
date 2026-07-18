/**
 * 選考/募集案内/宣伝 判定(lib/selection.ts)の動作チェック。
 * 実行: cd inbox && npx tsx scripts/check-selection.ts
 */
import { detectSelectionKind } from '../src/lib/selection'

let failed = 0
function check(label: string, actual: string, expected: string) {
  const ok = actual === expected
  console.log(`${ok ? '✅' : '❌'} ${label}${ok ? '' : ` — ${expected}のはずが${actual}`}`)
  if (!ok) failed++
}

check(
  '企業からの面接連絡は選考',
  detectSelectionKind('hr@pkshatech.n-ats.hrmos.co', '本日の面接について', '面接のご予定でした', 'interview'),
  'selection',
)
check(
  '企業からの課題提出依頼は選考',
  detectSelectionKind('mbox@em.talentio.com', '課題選考のご案内', '課題をご提出ください', 'task'),
  'selection',
)
check(
  '企業のインターン募集案内は募集案内',
  detectSelectionKind('jinji@example.co.jp', '夏インターンシップ募集開始', 'エントリーをお願いします', 'event'),
  'recruiting',
)
check(
  'Goodfind(slogan.jp)はセミナー案内でも宣伝',
  detectSelectionKind('student@slogan.jp', '限定セミナーのご案内', '面接対策セミナーを開催', 'event'),
  'promo',
)
check(
  'ビズリーチ・キャンパスは宣伝',
  detectSelectionKind('support@br-campus.jp', '夏IS参加確約', 'アマギフプレゼント', 'event'),
  'promo',
)
check(
  'スカウト媒体(OpenWork)は宣伝',
  detectSelectionKind('scout@openwork.jp', 'スカウトが届いています', '企業があなたに興味', 'other'),
  'promo',
)
check(
  'Slack通知は対象外',
  detectSelectionKind('no-reply@slack.com', 'サインイン通知', 'ワークスペースにログインしました', 'other'),
  'other',
)
check(
  '企業ドメインの選考結果は選考',
  detectSelectionKind('saiyo@example.com', '選考結果のご連絡', '厳正なる選考の結果', 'result'),
  'selection',
)

if (failed) {
  console.error(`\n${failed}件失敗`)
  process.exit(1)
}
console.log('\nすべて通過 🎉')
