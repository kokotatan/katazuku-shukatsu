import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isAutomaticRecordingEligible, type AutomaticRecordingCandidate } from '../src/recording-eligibility.js'
import { openDb } from '../src/db.js'
import { applyCalendar } from '../src/db-apply-calendar.js'
import { listCareerMeetings, upsertCareerMeeting } from '../src/career-support.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/recording-eligibility.json', import.meta.url), 'utf8')) as {
  base: AutomaticRecordingCandidate
  cases: { name: string; meeting: AutomaticRecordingCandidate; eligible: boolean }[]
}
for (const test of fixture.cases) {
  assert.equal(isAutomaticRecordingEligible({ ...fixture.base, ...test.meeting }), test.eligible, test.name)
}
console.log('録音対象の共通fixture: ' + fixture.cases.length + '件成功')

// 実DBではなくインメモリDBで、保存済みの古いtrueや明示trueが判定を迂回しないことを確認する。
const cases = [
  { title: 'オンライン面接', kind: '面接', url: fixture.base.url, eligible: true },
  { title: 'オンライン面談', kind: '面談', url: fixture.base.url, eligible: true },
  { title: 'インターン Day1', kind: '説明会', url: fixture.base.url, eligible: false },
  { title: '宿泊', kind: 'その他', url: fixture.base.url, eligible: false },
  { title: '説明会', kind: '説明会', url: fixture.base.url, eligible: true },
  { title: 'インターン説明会', kind: '説明会', url: fixture.base.url, eligible: true },
  { title: 'オンラインセミナー', kind: 'セミナー', url: fixture.base.url, eligible: true },
  { title: '対面面接', kind: '面接', url: fixture.base.url, eligible: false },
  { title: '面談', kind: '面談', url: '', eligible: false },
  { title: '面談を含むイベント', kind: 'その他', url: fixture.base.url, eligible: true },
]
for (const test of cases) {
  const db = openDb(':memory:')
  try {
    applyCalendar({ events: [{
      externalId: 'recording-example', company: '会社A', title: test.title, kind: test.kind,
      startAt: fixture.base.startAt!, endAt: fixture.base.endAt, url: test.url,
    }] }, db)
    const armed = Number((db.prepare('SELECT count(*) AS n FROM meeting_run').get() as { n: number }).n)
    assert.equal(armed, test.eligible ? 1 : 0, '予定の自動待機: ' + test.title)
    const result = upsertCareerMeeting(db, {
      externalId: 'support-example', organization: '支援組織A', title: test.title, kind: test.kind,
      startAt: fixture.base.startAt!, endAt: fixture.base.endAt, url: test.url, recordable: true,
    })
    const runCount = Number((db.prepare('SELECT count(*) AS n FROM career_meeting_run').get() as { n: number }).n)
    assert.equal(runCount, test.eligible ? 1 : 0, '支援予定の自動待機: ' + test.title)
    assert.equal(listCareerMeetings(db).find((row) => row.id === result.id)?.recordable, test.eligible)
    if (!test.eligible) {
      db.prepare('UPDATE career_meeting SET recordable = 1 WHERE id = ?').run(result.id)
      assert.equal(listCareerMeetings(db).find((row) => row.id === result.id)?.recordable, false, '既存trueの再判定: ' + test.title)
    }
  } finally { db.close() }
}
console.log('録音対象のDB反映・既存データ再判定: ' + cases.length + 'ケース成功')

const defaultsDb = openDb(':memory:')
try {
  const base = {
    externalId: 'update-example', organization: '支援組織A', title: '面談', kind: '面談',
    startAt: fixture.base.startAt!, endAt: fixture.base.endAt,
  }
  const created = upsertCareerMeeting(defaultsDb, { ...base, url: fixture.base.url })
  upsertCareerMeeting(defaultsDb, { ...base, endAt: '2028-01-10T16:00:00+09:00' })
  assert.equal(listCareerMeetings(defaultsDb).find((row) => row.id === created.id)?.recordable, true, 'URL省略の更新で既知のオンライン面談を失わない')
  upsertCareerMeeting(defaultsDb, { ...base, recordable: false })
  assert.equal(listCareerMeetings(defaultsDb).find((row) => row.id === created.id)?.recordable, false, '既知URLでも録音しない指定を守る')
  defaultsDb.prepare(`INSERT INTO career_meeting
    (external_id, title, start_at, end_at, url, status, source_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'scheduled', '', '', '')`).run(
      'default-example', '未分類イベント', fixture.base.startAt!, fixture.base.endAt!, fixture.base.url!,
    )
  const unspecified = listCareerMeetings(defaultsDb).find((row) => row.externalId === 'default-example')
  assert.equal(unspecified?.kind, 'その他')
  assert.equal(unspecified?.recordable, false, '未指定は自動録音しない')
} finally { defaultsDb.close() }
console.log('更新時のURL保持・録音拒否・未指定の既定値: 成功')
