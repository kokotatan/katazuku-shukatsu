import { strict as assert } from 'node:assert'
import { addAppointment, insertSelection, openDb, upsertCompany } from '../src/db.js'
import { blockMeetingPreparation, evaluateMeetingPreparation, meetingPreparationContext, meetingPreparationSnapshot, saveMeetingPreparation, type PreparationInput } from '../src/meeting-preparation.js'

const db = openDb(':memory:')
const now = new Date('2026-09-09T09:00:00Z')
const companyId = upsertCompany(db, { name: '準備検証株式会社' })
const selectionId = insertSelection(db, companyId, {
  company: '準備検証株式会社', position: 'エンジニア', season: '', priority: '', status: '選考中', steps: [],
  nextAction: '', nextDate: '', submitted: false, esUrl: '', memo: '',
})
const appointmentId = addAppointment(db, {
  selectionId, at: '2026-09-17T14:30:00+09:00', kind: '面談', title: 'VPoE面談', person: '担当者',
}).id
addAppointment(db, { selectionId, at: '2026-09-18T10:00:00+09:00', kind: 'テスト', title: '適性検査' })
addAppointment(db, { selectionId, at: '2026-09-08T14:30:00+09:00', kind: '面談', title: '過去の面談' })
const target = () => evaluateMeetingPreparation(db, now).find((appointment) => appointment.appointmentId === appointmentId)!
assert.equal(evaluateMeetingPreparation(db, now).length, 1, '未来の面接・面談だけを対象にする')
assert.equal(target().status, 'pending')
assert(target().reasons.some((reason) => reason.startsWith('企業研究')))

const createPreparation = (): PreparationInput => ({
  appointmentId, contextHash: target().contextHash, preparedAt: now.toISOString(), sourceRef: 'fixture:preparation',
  summary: '職種と期待を確認する', counterpartResearch: '公式プロフィールを確認', priorContext: '過去記録を確認',
  questionsToAsk: ['顧客課題は何か', '担当範囲はどこか', '期待する成果は何か'],
  anticipatedQuestions: [1, 2, 3].map((number) => ({ question: `質問${number}`, answerOutline: `本人の事実${number}`, evidenceRef: 'private/evidence.local.md' })),
  sources: [{ title: '採用公式', url: 'https://example.com/recruit' }], unknowns: ['配属先は面談で確認'],
})
assert.throws(() => saveMeetingPreparation(db, createPreparation(), now), /企業研究/)
db.prepare(`INSERT INTO company_dossier (company_id, summary, sources_json, researched_at, source_ref)
  VALUES (?, '事業の確認済み要約', ?, ?, 'fixture:research')`).run(companyId, JSON.stringify(createPreparation().sources), now.toISOString())
const preparation = createPreparation()
assert.throws(() => saveMeetingPreparation(db, { ...preparation, questionsToAsk: [] }, now), /逆質問/)
assert.throws(() => saveMeetingPreparation(db, { ...preparation, sources: [{ title: '不正', url: 'javascript:alert(1)' }] }, now), /一次情報/)
saveMeetingPreparation(db, preparation, now)
saveMeetingPreparation(db, preparation, now)
assert.equal(target().status, 'ready')
assert.equal((db.prepare('SELECT COUNT(*) AS count FROM appointment_preparation').get() as { count: number }).count, 1)
const before = target().contextHash
db.prepare("UPDATE appointment SET external_id='calendar-event', calendar_id='main' WHERE id=?").run(appointmentId)
assert.equal(target().contextHash, before, 'カレンダー紐付けだけでは再準備にしない')
db.prepare("UPDATE appointment SET person='別の担当者' WHERE id=?").run(appointmentId)
assert.equal(target().status, 'pending', '相手が変われば再準備にする')
assert.throws(() => saveMeetingPreparation(db, preparation, now), /根拠が変わり/)
saveMeetingPreparation(db, createPreparation(), now)
blockMeetingPreparation(db, appointmentId, '一次情報を取得できない', now)
assert(target().reasons.some((reason) => reason.includes('一次情報を取得できない')))
saveMeetingPreparation(db, createPreparation(), now)
const snapshot = meetingPreparationSnapshot(db, now)
assert.equal(snapshot[0].status, 'ready')
assert(!JSON.stringify(snapshot).includes('private/evidence.local.md'), '外部向けにはローカル証拠pathを出さない')
assert(!JSON.stringify(meetingPreparationContext(db, now)).includes('private/evidence.local.md'), 'agent contextにもローカル証拠pathを出さない')
const originalRole = process.env.KATAZUKU_DB_ROLE
process.env.KATAZUKU_DB_ROLE = 'replica'
assert.throws(() => saveMeetingPreparation(db, createPreparation(), now), /正本DB/)
if (originalRole === undefined) delete process.env.KATAZUKU_DB_ROLE
else process.env.KATAZUKU_DB_ROLE = originalRole
db.close()
console.log('面談準備: 全件再評価・根拠hash・鮮度・冪等・正本限定・証拠path除外を確認')
