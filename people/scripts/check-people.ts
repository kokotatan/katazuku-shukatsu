/**
 * People(会った人)の名寄せ・抽出ロジック(lib/people.ts, lib/names.ts)の動作チェック。
 * 実行: cd people && npx tsx scripts/check-people.ts
 */
import { sameCompany } from '../src/lib/names'
import { DEFAULT_CATEGORY, mergePeople, peopleForCompany, personCategory } from '../src/lib/people'
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
