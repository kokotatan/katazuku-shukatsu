/** 本人の対象外指示を後続入力が復活させず、人物調査を根拠付きで冪等反映することを確かめる。 */
import assert from 'node:assert/strict'
import { openDb, addAppointment, insertSelection, listCompanies, upsertCompany } from '../src/db.js'
import { startApplication } from '../src/application.js'
import { COMPANY_EXCLUSION_MARKER, excludeCompany, isCompanyExcluded } from '../src/company-preference.js'
import { applyCalendar } from '../src/db-apply-calendar.js'
import { applyMail } from '../src/db-apply-mail.js'
import { applyDiff } from '../src/db-apply.js'
import { applyPeopleResearch } from '../src/people-research.js'
import { applySubmissionRequirements } from '../src/submission-requirement.js'

const db = openDb(':memory:')
try {
  const companyId = upsertCompany(db, { name: '対象外株式会社', memo: '本人メモ' })
  const selectionId = insertSelection(db, companyId, {
    company: '対象外株式会社', season: '本選考', position: '総合職', priority: 'B', status: '選考中',
    steps: [], nextAction: '次回面接', nextDate: '2099-01-10', submitted: true, esUrl: '', memo: '',
  })
  addAppointment(db, {
    selectionId, at: '2099-01-10T10:00:00+09:00', endAt: '2099-01-10T11:00:00+09:00',
    kind: '面接', title: '二次面接', url: 'https://meet.example.com/excluded',
  })

  const first = excludeCompany(db, {
    name: '対象外株式会社', reason: '本人が応募を終了すると決定', ref: 'conversation:exclude-1',
  }, new Date('2099-01-01T00:00:00Z'))
  assert.deepEqual(first, { companyId, selections: 1, appointments: 1 })
  assert.equal(isCompanyExcluded(db, '株式会社対象外'), true)
  const company = db.prepare('SELECT memo FROM company WHERE id = ?').get(companyId) as { memo: string }
  assert(company.memo.includes(COMPANY_EXCLUSION_MARKER))
  assert(company.memo.includes('本人メモ'))
  const selection = db.prepare('SELECT status, outcome, next_action, next_date FROM selection WHERE id = ?').get(selectionId) as {
    status: string; outcome: string; next_action: string; next_date: string
  }
  assert.equal(selection.status, '辞退')
  assert.equal(selection.outcome, '辞退')
  assert.equal(selection.next_date, '')
  assert(selection.next_action.includes('本人が応募を終了'))
  assert.equal((db.prepare('SELECT status FROM appointment WHERE selection_id = ?').get(selectionId) as { status: string }).status, '中止')

  const repeated = excludeCompany(db, {
    name: '対象外株式会社', reason: '本人が応募を終了すると決定', ref: 'conversation:exclude-1',
  }, new Date('2099-01-01T00:00:00Z'))
  assert.deepEqual(repeated, { companyId, selections: 0, appointments: 0 })

  const diff = applyDiff(db, [{ name: '対象外株式会社', stage: 'interview', position: '総合職' }])
  assert.deepEqual(diff.skipped, ['対象外株式会社'])
  assert.equal((db.prepare('SELECT status FROM selection WHERE id = ?').get(selectionId) as { status: string }).status, '辞退')

  const requirements = applySubmissionRequirements(db, [{
    sourceRef: 'mail:excluded-requirement', company: '対象外株式会社', kind: 'pledge', title: '誓約書', status: 'required',
  }])
  assert.deepEqual(requirements, { created: 0, updated: 0, completed: 0 })
  assert.equal((db.prepare('SELECT count(*) AS n FROM submission_requirement').get() as { n: number }).n, 0)

  const calendar = applyCalendar({ events: [{
    externalId: 'excluded-calendar', title: '復活してはいけない面接', startAt: '2099-01-20T10:00:00+09:00',
    company: '対象外株式会社', position: '総合職', kind: '面接',
  }] }, db)
  assert.deepEqual(calendar, { created: 0, updated: 0, unchanged: 0, promoted: 0 })

  const mail = applyMail(db, { items: [{
    id: 'excluded-mail', receivedAt: '2099-01-02T00:00:00Z', subject: '追加選考のご案内',
    company: '対象外株式会社', position: '総合職', needsAction: true,
  }] })
  assert.equal(mail.created, 1)
  const mailLinks = db.prepare('SELECT company_id, selection_id FROM mail_item WHERE id = ?').get('excluded-mail') as {
    company_id: number | null; selection_id: number | null
  }
  assert.equal(mailLinks.company_id, null)
  assert.equal(mailLinks.selection_id, null)

  assert.throws(() => startApplication(db, {
    company: '対象外株式会社', position: '別職種', materialsRef: 'materials:excluded', sourceRef: 'application:excluded',
  }), /就活管理対象外/)

  const research = {
    sourceRef: 'official:team-page', researchedAt: '2099-01-03T00:00:00Z',
    people: [
      { name: '採用担当A', company: '調査先株式会社', role: '採用責任者', category: '採用担当', notes: ['公式チームページに役職を掲載'], confidence: 0.95 },
      { name: '学生B', company: '架空大学', role: '学生', category: '就活生', notes: ['本人公開プロフィールで確認'], confidence: 0.8 },
    ],
  }
  assert.deepEqual(applyPeopleResearch(db, research), { people: 2, notes: 2 })
  assert.deepEqual(applyPeopleResearch(db, research), { people: 2, notes: 0 })
  const companies = listCompanies(db).map((row) => row.name)
  assert(companies.includes('調査先株式会社'))
  assert(!companies.includes('架空大学'), '学生の所属大学を応募企業マスタへ追加しない')
  assert.equal((db.prepare('SELECT count(*) AS n FROM person_note').get() as { n: number }).n, 2)

  const peopleBefore = (db.prepare('SELECT count(*) AS n FROM person').get() as { n: number }).n
  assert.throws(() => applyPeopleResearch(db, {
    sourceRef: 'official:bad', researchedAt: '2099-01-04T00:00:00Z',
    people: [{ name: '不正入力', notes: ['根拠'], confidence: 1.5 }],
  }), /人物と根拠/)
  assert.equal((db.prepare('SELECT count(*) AS n FROM person').get() as { n: number }).n, peopleBefore)

  console.log('企業対象外・人物調査: 復活防止、ローカル停止、企業汚染防止、根拠付き冪等反映を確認')
} finally {
  db.close()
}
