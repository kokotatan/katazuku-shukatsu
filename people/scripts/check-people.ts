/**
 * People(会った人)の名寄せ・抽出ロジック(lib/people.ts, lib/names.ts)の動作チェック。
 * 実行: cd people && npx tsx scripts/check-people.ts
 */
import { sameCompany } from '../src/lib/names'
import {
  DEFAULT_CATEGORY,
  distinctCompanies,
  distinctMonths,
  mergePeople,
  metMonth,
  peopleForCompany,
  personCategory,
} from '../src/lib/people'
import type { Person } from '../src/types'

let failed = 0
function check(label: string, cond: boolean) {
  console.log(`${cond ? 'OK ' : 'NG '} ${label}`)
  if (!cond) failed++
}

const person = (p: Partial<Person>): Person => ({
  id: Math.random().toString(36).slice(2),
  name: '名無し',
  company: '',
  role: '',
  category: '面接官',
  metAt: '',
  howMet: '',
  notes: '',
  followUp: false,
  updatedAt: '2026-07-16T00:00:00Z',
  ...p,
})

check('名寄せ: 株式会社の有無', sameCompany('株式会社PKSHA Technology', 'PKSHA'))
check('名寄せ: 全角カッコ', sameCompany('ギフティ（Giftee）', 'ギフティ(Giftee)'))
check('名寄せ: 短名は完全一致のみ', !sameCompany('Go', 'Google'))

const people: Person[] = [
  person({ name: '田中', company: '株式会社PKSHA Technology', followUp: true }),
  person({ name: '佐藤', company: 'PKSHA' }),
  person({ name: '鈴木', company: 'ギフティ（Giftee）', followUp: true }),
  person({ name: '高橋', company: 'キャディ' }),
]

check('会った人: 株式会社の有無で名寄せ(PKSHA=2人)', peopleForCompany(people, 'PKSHA').length === 2)
check('会った人: 全半角カッコ揺れで名寄せ', peopleForCompany(people, 'ギフティ(Giftee)').length === 1)
check('会った人: 他社は混ざらない', peopleForCompany(people, 'PKSHA').every((p) => p.name !== '高橋'))
check('会った人: followUp抽出', people.filter((p) => p.followUp).length === 2)

// 出会った時期: metAt 先頭の YYYY-MM を導出(グリッド上部フィルタの選択肢)
check('時期: YYYY-MM を導出', metMonth({ metAt: '2026-07 二次面接' }) === '2026-07')
check('時期: スラッシュ・1桁月をゼロ詰め', metMonth({ metAt: '2026/7' }) === '2026-07')
check('時期: 和文の年月', metMonth({ metAt: '2026年7月 説明会' }) === '2026-07')
check('時期: 年の無い簡易表記は不確定なので空', metMonth({ metAt: '7/16 二次面接' }) === '')
check('時期: 空/未設定は空', metMonth({}) === '' && metMonth({ metAt: '' }) === '')
check('時期: 不正な月(13)は空', metMonth({ metAt: '2026-13' }) === '')

// フィルタの選択肢: 会社は重複除去・50音順、年月は重複除去・新しい順
const forFilter = [
  person({ name: 'A', company: 'キャディ', metAt: '2026-07 面接' }),
  person({ name: 'B', company: '株式会社PKSHA Technology', metAt: '2026/05 説明会' }),
  person({ name: 'C', company: 'キャディ', metAt: '2026-07 二次' }), // 会社重複
  person({ name: 'D', company: '', metAt: '2026年7月' }), // 会社無し(選択肢に出さない)
]
const companies = distinctCompanies(forFilter)
check('会社選択肢: 重複除去で2社', companies.length === 2)
check('会社選択肢: 空の会社は含めない', !companies.includes(''))
const months = distinctMonths(forFilter)
check('年月選択肢: 重複除去で2件', months.length === 2)
check('年月選択肢: 新しい順(先頭が2026-07)', months[0] === '2026-07')

// 種別: 未設定/空は既定「面接官」扱い、設定済みはそのまま
check('種別: 未設定は既定(面接官)', personCategory({}) === DEFAULT_CATEGORY)
check('種別: 空文字は既定(面接官)', personCategory({ category: '  ' }) === '面接官')
check('種別: 設定済みはそのまま', personCategory({ category: '学生' }) === '学生')

// インポート: id/updatedAt 欠損の補完、category 補完、非破壊マージ
const base: Person[] = [person({ name: '田中', company: '株式会社PKSHA Technology' })]
const incoming: Partial<Person>[] = [
  { name: '田中', company: 'PKSHA' }, // 既存と name+company 一致 → 追加しない
  { name: '中村', company: 'キャディ', category: '学生' }, // 新規(id/updatedAt無し)
  { name: '中村', company: 'キャディ' }, // 取り込み内での重複 → 追加しない
  { name: '', company: 'どこか' }, // 名前無し → 取り込まない
]
const { merged, added } = mergePeople(base, incoming)
check('インポート: 追加は1件のみ(重複・空名は除外)', added === 1)
check('インポート: 合計2件になる', merged.length === 2)
const nakamura = merged.find((p) => p.name === '中村')
check('インポート: id を自動採番', !!nakamura && nakamura.id.length > 0)
check('インポート: updatedAt を自動補完', !!nakamura && nakamura.updatedAt.length > 0)
check('インポート: category を保持', nakamura?.category === '学生')
check('インポート: 既存(田中)を破壊しない', merged.some((p) => p.name === '田中'))

if (failed) {
  console.error(`\n${failed}件失敗`)
  process.exit(1)
}
console.log('\nすべて通過')
