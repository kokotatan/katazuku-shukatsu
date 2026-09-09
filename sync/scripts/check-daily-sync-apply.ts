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
import { evaluateSubmissionReadiness } from '../src/submission-readiness'
import { listSubmissionRequirements } from '../src/submission-requirement'

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
    requirements: [],
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
check('schema: インターン交通費情報を受理する', (() => {
  try {
    validateDailySyncResult(base({ selections: [{
      name: '交通費テスト社',
      stage: 'intern',
      appointments: [{
        at: '2026-10-06T11:00:00+09:00',
        endAt: '2026-10-06T18:30:00+09:00',
        kind: 'インターン',
        title: '1dayインターン',
        reimbursementStatus: 'full',
        receiptRequired: true,
      }],
    }] }))
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

// --- 日立ケース回帰: 複数成果物を別々に保持し、1件だけ残っても追跡を止めない ---
const hitachi = openDb(':memory:')
const initialHitachi = base({
  generatedAt: '2026-08-08T00:00:00Z',
  selections: [{ name: '株式会社日立製作所', stage: 'intern', position: '研究開発グループ 夏季特別インターン' }],
  mailItems: [{
    id: 'hitachi:request', receivedAt: '2026-08-07T05:51:58Z',
    subject: '夏季特別インターンシップ詳細', company: '株式会社日立製作所',
    position: '研究開発グループ 夏季特別インターン', needsAction: true, deadline: '2026-08-23',
  }],
  requirements: [
    { sourceRef: 'hitachi:request', company: '株式会社日立製作所', position: '研究開発グループ 夏季特別インターン', kind: 'pledge', title: '誓約書', deadline: '2026-08-23', status: 'required' },
    { sourceRef: 'hitachi:request', company: '株式会社日立製作所', position: '研究開発グループ 夏季特別インターン', kind: 'insurance_certificate', title: '賠償責任・傷害保険の加入証明書', deadline: '2026-08-23', status: 'required' },
    { sourceRef: 'hitachi:request', company: '株式会社日立製作所', position: '研究開発グループ 夏季特別インターン', kind: 'self_intro', title: '自己紹介スライド', deadline: '2026-08-23', status: 'required' },
  ],
})
const h1 = applyDailySyncResult(hitachi, initialHitachi)
check('日立回帰: 3成果物を別々に台帳化する', h1.requirements.created === 3, JSON.stringify(h1.requirements))
const confirmation = base({
  generatedAt: '2026-08-24T00:45:22Z',
  requirements: [
    { sourceRef: 'hitachi:confirm', company: '株式会社日立製作所', position: '研究開発グループ 夏季特別インターン', kind: 'pledge', title: '誓約書', status: 'completed' },
    { sourceRef: 'hitachi:confirm', company: '株式会社日立製作所', position: '研究開発グループ 夏季特別インターン', kind: 'self_intro', title: '自己紹介スライド', status: 'completed' },
  ],
})
const h2 = applyDailySyncResult(hitachi, confirmation)
check('日立回帰: 確認済み2件だけを完了にする', h2.requirements.completed === 2, JSON.stringify(h2.requirements))
const openHitachi = listSubmissionRequirements(hitachi, { openOnly: true })
check('日立回帰: 保険加入証明書だけが未完了で残る',
  openHitachi.length === 1 && openHitachi[0].kind === 'insurance_certificate', JSON.stringify(openHitachi))
applyDailySyncResult(hitachi, initialHitachi)
const afterBackfill = listSubmissionRequirements(hitachi, { openOnly: true })
check('日立回帰: 古い依頼メールのbackfillで完了済み2件を未完了へ戻さない',
  afterBackfill.length === 1 && afterBackfill[0].kind === 'insurance_certificate', JSON.stringify(afterBackfill))
const proactive = evaluateSubmissionReadiness(hitachi, new Date('2026-08-08T00:00:00Z'))
check('日立回帰: 締切15日前でも受信直後から準備対象になる',
  proactive.length === 1 && proactive[0].severity === 'prepare', JSON.stringify(proactive))
const urgent = evaluateSubmissionReadiness(hitachi, new Date('2026-08-22T00:00:00+09:00'))
check('日立回帰: 48時間以内はurgentへ昇格する',
  urgent.length === 1 && urgent[0].severity === 'urgent', JSON.stringify(urgent))

const sameBatch = openDb(':memory:')
const sameBatchResult = applyDailySyncResult(sameBatch, base({
  selections: [{ name: '同時処理社', stage: 'entried', position: '本選考' }],
  requirements: [{ sourceRef: 'same:req', company: '同時処理社', position: '本選考', kind: 'es', title: 'ES', deadline: '2026-09-10', status: 'required' }],
  submissions: [{ sourceRef: 'same:submitted', company: '同時処理社', position: '本選考', kind: 'ES', submittedAt: '2026-09-01T10:00:00+09:00' }],
}))
check('同一同期内の提出根拠で要求台帳を完了し、未完了へ戻さない',
  sameBatchResult.submissions.created === 1 && listSubmissionRequirements(sameBatch, { openOnly: true }).length === 0)

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

// --- 曖昧な会社(複数トラック+position無し)のメールで同期全体を止めない ---
// メールは company_id があれば足りる。selection特定に失敗しても、そのメール1件で
// 後続の提出反映まで巻き添えにしない(提出物の失敗隔離と対称にする)。
const ambiMail = openDb(':memory:')
const ambiCid = upsertCompany(ambiMail, { name: '二股社' })
insertSelection(ambiMail, ambiCid, { company: '二股社', season: '', position: 'A職', priority: '', status: '選考中', steps: [], nextAction: '', nextDate: '', submitted: false, esUrl: '', memo: '' })
insertSelection(ambiMail, ambiCid, { company: '二股社', season: '', position: 'B職', priority: '', status: '選考中', steps: [], nextAction: '', nextDate: '', submitted: false, esUrl: '', memo: '' })
const oneTrackCid = upsertCompany(ambiMail, { name: '一途社' })
insertSelection(ambiMail, oneTrackCid, { company: '一途社', season: '', position: '総合職', priority: '', status: '選考中', steps: [], nextAction: '', nextDate: '', submitted: false, esUrl: '', memo: '' })
let ambiThrew = false
let s4: ReturnType<typeof applyDailySyncResult> | null = null
try {
  s4 = applyDailySyncResult(ambiMail, base({
    mailItems: [{ id: 'mail:amb', receivedAt: '2026-07-20T12:00:00Z', subject: '選考のご案内', company: '二股社' }],
    submissions: [{ sourceRef: 'sub:one', company: '一途社', kind: 'ES', submittedAt: '2026-07-20T12:00:00Z' }],
  }))
} catch {
  ambiThrew = true
}
check('曖昧な会社のメールでも同期は例外を投げない', !ambiThrew)
check('曖昧なメールも記録される(company_idは付くがselection_idは付かない)', (() => {
  const row = ambiMail.prepare("SELECT company_id AS c, selection_id AS s FROM mail_item WHERE id = 'mail:amb'").get() as { c: number | null; s: number | null } | undefined
  return s4?.mail.created === 1 && row?.c === ambiCid && row?.s === null
})(), JSON.stringify(s4?.mail))
check('曖昧なメールの後でも提出物は反映される', s4?.submissions.created === 1, JSON.stringify(s4?.submissions))

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
