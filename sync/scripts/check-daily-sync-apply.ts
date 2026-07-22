/**
 * daily-sync 決定論的executor(daily-sync-apply.ts)のチェック。
 * モデル抽出JSONの schema検証 → 既存db-apply束ね反映が、
 * 冪等・暴走ブレーキ・提出失敗の隔離とともに正しく効くことを確認する。
 * 実行: cd sync && npx tsx scripts/check-daily-sync-apply.ts
 */
import { DatabaseSync } from 'node:sqlite'
import { openDb, upsertCompany, insertSelection, listSelections } from '../src/db'
import {
  applyDailySyncResult,
  validateDailySyncResult,
  type DailySyncResult,
} from './daily-sync-apply'

let failed = 0
function check(label: string, cond: boolean, detail = '') {
  console.log(`${cond ? '[OK]' : '[NG]'} ${label}${cond ? '' : ` — ${detail}`}`)
  if (!cond) failed++
}
function expectThrow(label: string, fn: () => unknown, pattern: RegExp) {
  try {
    fn()
    check(label, false, '例外が発生しませんでした')
  } catch (error) {
    check(label, pattern.test((error as Error).message), (error as Error).message)
  }
}

function base(overrides: Partial<DailySyncResult> = {}): DailySyncResult {
  return {
    schemaVersion: 1,
    generatedAt: '2026-07-20T13:00:00Z',
    selections: [],
    mailItems: [],
    submissions: [],
    ...overrides,
  }
}

// --- schema検証(適合しなければDBに触れない) ---
expectThrow(
  'schema: 未知の項目を拒否する',
  () => validateDailySyncResult({ ...base(), bogus: true }),
  /schemaに一致しません/,
)
expectThrow(
  'schema: 不正なstage値を拒否する',
  () => validateDailySyncResult(base({ selections: [{ name: 'X', stage: 'unknown' as never }] })),
  /schemaに一致しません/,
)
expectThrow(
  'schema: mailItemのid欠落を拒否する',
  () => validateDailySyncResult(base({ mailItems: [{ receivedAt: 'r', subject: 's' } as never] })),
  /schemaに一致しません/,
)
check('schema: 正常な最小結果は通る', (() => {
  try {
    validateDailySyncResult(base())
    return true
  } catch {
    return false
  }
})())

// --- 反映(1接続で束ねる) ---
const db: DatabaseSync = openDb(':memory:')
const result = base({
  selections: [
    { name: 'テスト商事', stage: 'entried', position: 'エンジニア', nextAction: 'ES提出', ref: 'mail:aaa' },
  ],
  mailItems: [
    { id: 'mail:aaa', receivedAt: '2026-07-20T12:00:00Z', subject: 'ES提出のお願い', company: 'テスト商事', summary: '一次', needsAction: true },
  ],
  submissions: [
    { sourceRef: 'sub:aaa', company: 'テスト商事', position: 'エンジニア', kind: 'ES', submittedAt: '2026-07-20T12:30:00Z' },
  ],
  priorityMails: [{ subject: '人事面談の日程調整', reason: '面談調整は見逃し厳禁' }],
})

const s1 = applyDailySyncResult(db, result)
check('選考が追加される', s1.selections.added.includes('テスト商事'), JSON.stringify(s1.selections))
check('メールが1件追加される', s1.mail.created === 1, JSON.stringify(s1.mail))
check('提出結果が1件追加される', s1.submissions.created === 1, JSON.stringify(s1.submissions))
check('最優先メールがそのまま渡る', s1.priorityMails.length === 1 && s1.priorityMails[0].subject.includes('人事面談'))

// --- 冪等性(同じ結果を2回反映しても増殖しない) ---
const s2 = applyDailySyncResult(db, result)
check('2回目: メールは更新(追加0)', s2.mail.created === 0 && s2.mail.updated === 1, JSON.stringify(s2.mail))
check('2回目: 提出は既反映(追加0)', s2.submissions.created === 0 && s2.submissions.duplicate === 1, JSON.stringify(s2.submissions))
const testCoRows = listSelections(db).filter((r) => r.company === 'テスト商事')
check('選考トラックが重複しない', testCoRows.length === 1, `tracks=${testCoRows.length}`)

// --- 提出物の失敗を隔離する(全体は止めない) ---
const ambiguous = openDb(':memory:')
const cid = upsertCompany(ambiguous, { name: '二股社' })
insertSelection(ambiguous, cid, { company: '二股社', season: '', position: 'A職', priority: '', status: '選考中', steps: [], nextAction: '', nextDate: '', submitted: false, esUrl: '', memo: '' })
insertSelection(ambiguous, cid, { company: '二股社', season: '', position: 'B職', priority: '', status: '選考中', steps: [], nextAction: '', nextDate: '', submitted: false, esUrl: '', memo: '' })
const s3 = applyDailySyncResult(ambiguous, base({
  mailItems: [{ id: 'mail:ok', receivedAt: '2026-07-20T12:00:00Z', subject: '通常メール' }],
  submissions: [{ sourceRef: 'sub:amb', company: '二股社', kind: 'ES', submittedAt: '2026-07-20T12:00:00Z' }],
}))
check('曖昧な提出は失敗として隔離される', s3.submissions.errors.length === 1, JSON.stringify(s3.submissions))
check('提出が失敗してもメールは反映される', s3.mail.created === 1, JSON.stringify(s3.mail))

// --- 暴走ブレーキ ---
const many = base({
  selections: Array.from({ length: 16 }, (_, i) => ({ name: `暴走${i}`, stage: 'entried' as const })),
})
expectThrow('16社超はブレーキで中止する', () => applyDailySyncResult(openDb(':memory:'), many), /上限/)
check('--forceでブレーキを解除できる', (() => {
  const forced = applyDailySyncResult(openDb(':memory:'), many, { force: true })
  return forced.selections.added.length === 16
})())

console.log(`daily-sync-apply テスト: ${failed === 0 ? '全件成功' : failed + '件失敗'}`)
if (failed) process.exit(1)
