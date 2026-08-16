/**
 * platform 層の writer / 読み口の対応チェック(#9)。
 * インメモリSQLite。フィクスチャは実在名ではなく合成ラベル。
 *   npm run test:platform
 */
import { DatabaseSync } from 'node:sqlite'
import { openDb, upsertCompany } from '../src/db.js'
import {
  saveBasicProfile, getBasicProfile, upsertCompanyDossier, upsertMailItem,
  listActionableMail, listPlatformSnapshot,
} from '../src/platform.js'

let failed = 0
function check(label: string, cond: boolean, detail = '') {
  console.log(`${cond ? '[ok]' : '[FAIL]'} ${label}${cond ? '' : ` — ${detail}`}`)
  if (!cond) failed++
}

const db: DatabaseSync = openDb(':memory:')
const companyA = upsertCompany(db, { name: '株式会社サンプルA' })

// --- profile_basic(設定GUIの保存先) ---
saveBasicProfile(db, { graduationYear: 2028, preferredArea: '（地域）' }, 'test')
const profile = getBasicProfile(db) as Record<string, unknown>
check('プロフィールを保存して読み戻せる', profile.graduationYear === 2028)
saveBasicProfile(db, { graduationYear: 2029 }, 'test')
check('プロフィールは1行に収束する(上書き)',
  (getBasicProfile(db) as Record<string, unknown>).graduationYear === 2029)
const rows = db.prepare('SELECT COUNT(*) AS n FROM profile_basic').get() as { n: number }
check('プロフィールの行は常に1行', rows.n === 1)

// 写真のような画像データはスナップショットへ出さない(既存の stripImages 契約)
saveBasicProfile(db, { name: '（氏名）', photo: 'data:image/png;base64,AAA', photoKey: 'k1' })
const snapProfile = listPlatformSnapshot(db).profile as Record<string, unknown>
check('スナップショットに画像本体を出さない', !('photo' in snapProfile) && snapProfile.photoKey === 'k1')

// --- company_dossier(企業研究) ---
upsertCompanyDossier(db, companyA, {
  summary: '（要約）', facts: { employees: 100 }, sources: ['https://example.com/ir'],
  researchedAt: '2026-08-16T00:00:00Z', sourceRef: 'run-1',
})
upsertCompanyDossier(db, companyA, {
  summary: '（更新後の要約）', facts: { employees: 120 }, sources: [],
  researchedAt: '2026-08-16T01:00:00Z', sourceRef: 'run-2',
})
const dossiers = listPlatformSnapshot(db).dossiers
check('企業研究は1社1件に収束する', dossiers.length === 1)
check('企業研究は新しい結果で上書きされる',
  dossiers[0].summary === '（更新後の要約）'
  && (dossiers[0].facts as Record<string, unknown>).employees === 120)

// --- mail_item(受信メールの要約台帳) ---
upsertMailItem(db, {
  id: 'msg-1', companyId: companyA, receivedAt: '2026-08-16T09:00:00Z',
  sender: 'noreply@example.com', subject: '（件名）', summary: '（要約）',
  category: '選考案内', needsAction: true, deadline: '2026-08-20',
})
upsertMailItem(db, {
  id: 'msg-1', companyId: companyA, receivedAt: '2026-08-16T09:00:00Z',
  sender: 'noreply@example.com', subject: '（件名）', summary: '（再取り込みで更新）',
  category: '選考案内', needsAction: true, deadline: '2026-08-20',
})
const mails = listPlatformSnapshot(db).mailItems
check('同じメールを二度取り込んでも1行', mails.length === 1)
check('再取り込みは最新の内容で上書きする', mails[0].summary === '（再取り込みで更新）')
check('会社名がJOINで引ける', mails[0].company === '株式会社サンプルA')

upsertMailItem(db, { id: 'msg-2', receivedAt: '2026-08-16T10:00:00Z', subject: '（お知らせ）', needsAction: false })
upsertMailItem(db, { id: 'msg-3', receivedAt: '2026-08-15T10:00:00Z', subject: '（締切なし要対応）', needsAction: true })
const actionable = listActionableMail(db)
check('要対応だけを返す', actionable.length === 2 && !actionable.some((m) => m.id === 'msg-2'))
check('締切ありを先に、締切なしを後ろに並べる',
  actionable[0].id === 'msg-1' && actionable[1].id === 'msg-3')
upsertMailItem(db, { id: 'msg-3', receivedAt: '2026-08-15T10:00:00Z', subject: '（締切なし要対応）', needsAction: true, status: '完了' })
check('完了にしたものは要対応から外れる', listActionableMail(db).length === 1)

// --- 会社に紐づかないメールも保持できる(company_id は任意) ---
check('会社不明のメールも読み口に出る',
  listPlatformSnapshot(db).mailItems.some((m) => m.id === 'msg-2' && m.company === null))

if (failed) { console.error(`\n${failed}件失敗`); process.exit(1) }
console.log('\nすべて通過')
