/**
 * People(会った人)の名寄せ・抽出ロジック(lib/people.ts, lib/names.ts)の動作チェック。
 * 実行: cd people && npx tsx scripts/check-people.ts
 */
import { sameCompany } from '../src/lib/names'
import { peopleForCompany } from '../src/lib/people'
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

if (failed) {
  console.error(`\n${failed}件失敗`)
  process.exit(1)
}
console.log('\nすべて通過')
