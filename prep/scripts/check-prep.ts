/**
 * Prepの名寄せ・選択ロジック(lib/select.ts, lib/names.ts)の動作チェック。
 * 実行: cd prep && npx tsx scripts/check-prep.ts
 */
import { sameCompany } from '../src/lib/names'
import { companySummary, focusDeck, retrospectives } from '../src/lib/select'
import type { PrepEntry } from '../src/types'

let failed = 0
function check(label: string, cond: boolean) {
  console.log(`${cond ? 'OK ' : 'NG '} ${label}`)
  if (!cond) failed++
}

const e = (p: Partial<PrepEntry>): PrepEntry => ({
  id: Math.random().toString(36).slice(2),
  company: '',
  kind: 'qa',
  question: 'Q',
  answer: 'A',
  updatedAt: '2026-06-12T00:00:00Z',
  ...p,
})

check('名寄せ: 株式会社の有無', sameCompany('株式会社PKSHA Technology', 'PKSHA'))
check('名寄せ: 全角カッコ', sameCompany('ギフティ（Giftee）', 'ギフティ(Giftee)'))
check('名寄せ: 短名は完全一致のみ', !sameCompany('Go', 'Google'))

const entries: PrepEntry[] = [
  e({ kind: 'axis', question: '就活の軸', updatedAt: '2026-06-01T00:00:00Z' }),
  e({ kind: 'qa', company: '株式会社PKSHA Technology', question: 'なぜPKSHA?' }),
  e({ kind: 'qa', company: 'キャディ', question: 'なぜキャディ?' }),
  e({ kind: 'retro', company: 'PKSHA', question: '一次面接', updatedAt: '2026-06-10T00:00:00Z' }),
  e({ kind: 'retro', company: 'ニアメロ', question: 'CTO面接', updatedAt: '2026-06-05T00:00:00Z' }),
]

const deck = focusDeck(entries, 'PKSHA')
check('直前モード: 軸→問答→振り返りの順', deck.length === 3 && deck[0].kind === 'axis' && deck[1].kind === 'qa' && deck[2].kind === 'retro')
check('直前モード: 他社の問答は混ざらない', !deck.some((d) => d.company === 'キャディ'))

const summary = companySummary(entries)
check('企業集約: 表記ゆれのPKSHAが1グループ(2件)', summary.find((g) => sameCompany(g.company, 'PKSHA'))?.count === 2)
check('企業集約: axis(会社なし)は数えない', summary.every((g) => g.company !== ''))

const retros = retrospectives(entries)
check('振り返り横断: 新しい順', retros.length === 2 && retros[0].company === 'PKSHA')

if (failed) {
  console.error(`\n${failed}件失敗`)
  process.exit(1)
}
console.log('\nすべて通過')
