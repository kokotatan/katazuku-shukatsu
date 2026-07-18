/**
 * 文字数カウント(lib/count.ts)の動作チェック。
 * 実行: cd notes && npx tsx scripts/check-count.ts
 */
import { countChars, targetLabel } from '../src/lib/count'

let failed = 0
function check(label: string, cond: boolean) {
  console.log(`${cond ? 'OK ' : 'NG '} ${label}`)
  if (!cond) failed++
}

check('全角のみ', countChars('私は学生です').chars === 6)
check('改行は数えない', countChars('一行目\n二行目\r\n三行目').chars === 9)
check('全角空白は数える', countChars('あ　い').chars === 3)
check('半角空白も数える', countChars('a b').chars === 3)
check('空文字', countChars('').chars === 0)

const mixed = countChars('AIで研究をDXする') // 半角4(A,I,D,X) + 全角6
check('混在の文字数', mixed.chars === 10)
check('全角換算は半角0.5切り上げ', mixed.zenkaku === 8) // 10 - 4/2 = 8

const kana = countChars('ｶﾞｸﾁｶ') // 半角カナ5文字
check('半角カナは0.5換算', kana.zenkaku === 3) // 5 - 5/2 = 2.5 -> 3

check('目標なし', targetLabel(100, null) === null)
check('あと表示', targetLabel(348, 400)?.text === 'あと52字')
check('オーバー表示', targetLabel(412, 400)?.text === '12字オーバー' && targetLabel(412, 400)?.over === true)
check('ぴったり', targetLabel(400, 400)?.text === 'ぴったり')

if (failed) {
  console.error(`\n${failed}件失敗`)
  process.exit(1)
}
console.log('\nすべて通過')
