/**
 * 応募自動運転の承認、安全境界、冪等化、カレンダーoutboxを検証する。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb } from '../src/db'
import {
  applyApplicationEvent,
  linkCalendarAppointment,
  listApplicationRuns,
  listCalendarOutbox,
  listWebAssessments,
  startApplication,
  type ApplicationMaterialInput,
  type AssessmentInput,
} from '../src/application'

const db = openDb(':memory:')
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
let passed = 0
let failed = 0

function check(name: string, fn: () => void): void {
  try {
    fn()
    passed += 1
    console.log('[OK] ' + name)
  } catch (error) {
    failed += 1
    console.error('[NG] ' + name + ': ' + (error as Error).message)
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function expectThrow(fn: () => unknown, pattern: RegExp): void {
  try {
    fn()
  } catch (error) {
    if (pattern.test((error as Error).message)) return
    throw error
  }
  throw new Error('例外が発生しませんでした')
}

check('応募JSON Schemaが読め、本文・問題・解答用の項目を持たない', () => {
  const startSchema = JSON.parse(readFileSync(join(repoRoot, 'schemas', 'application-start.schema.json'), 'utf8')) as {
    additionalProperties: boolean
  }
  const eventText = readFileSync(join(repoRoot, 'schemas', 'application-event.schema.json'), 'utf8')
  const eventSchema = JSON.parse(eventText) as {
    additionalProperties: boolean
    $defs: Record<string, { additionalProperties: boolean; properties: Record<string, unknown> }>
  }
  assert(startSchema.additionalProperties === false && eventSchema.additionalProperties === false, '未知項目が許可されています')
  const forbidden = ['content', 'body', 'draft', 'answer', 'questionScreenshot']
  for (const name of forbidden) {
    assert(!(name in eventSchema.$defs.material.properties), 'materialに禁止項目があります: ' + name)
    assert(!(name in eventSchema.$defs.assessment.properties), 'assessmentに禁止項目があります: ' + name)
  }
})

const started = startApplication(db, {
  runId: 'run-application-test',
  company: 'テスト株式会社',
  position: '28卒プロダクト職',
  season: '28卒本選考',
  entryUrl: 'https://example.test/entry',
  materialsRef: 'private-ledger:test-company',
  sourceRef: 'test:start:001',
  startedAt: '2026-07-18T10:00:00+09:00',
})

check('runを開始し、出願予定トラックを作る', () => {
  assert(started.created, 'runが作成されていません')
  const row = db.prepare('SELECT status FROM selection WHERE id = ?').get(started.selectionId) as { status: string }
  assert(row.status === '出願予定', 'status=' + row.status)
})

check('同じsourceRefの開始は冪等', () => {
  const duplicate = startApplication(db, {
    company: 'テスト株式会社',
    position: '28卒プロダクト職',
    materialsRef: 'private-ledger:test-company',
    sourceRef: 'test:start:001',
  })
  assert(!duplicate.created && duplicate.runId === started.runId, '重複runが作成されました')
})

check('未定義のイベント種別を拒否する', () => {
  expectThrow(() => applyApplicationEvent(db, {
    eventId: 'event:unknown-type',
    runId: started.runId,
    type: 'submit_without_review',
  } as never), /type が不正/)
})

check('フォーム入力後は本人確認待ち', () => {
  const result = applyApplicationEvent(db, {
    eventId: 'event:entry-filled',
    runId: started.runId,
    type: 'entry_filled',
    at: '2026-07-18T10:05:00+09:00',
  })
  assert(result.state === 'entry_review', 'state=' + result.state)
})

check('本人承認なしのエントリー送信を拒否し、ロールバックする', () => {
  expectThrow(() => applyApplicationEvent(db, {
    eventId: 'event:entry-submit-denied',
    runId: started.runId,
    type: 'entry_submitted',
    at: '2026-07-18T10:10:00+09:00',
  }), /本人の最終承認/)
  const count = db.prepare("SELECT COUNT(*) AS n FROM submission WHERE kind = 'エントリー'").get() as { n: number }
  assert(count.n === 0, 'submissionが残りました')
})

check('本人承認後のエントリー送信を記録する', () => {
  const result = applyApplicationEvent(db, {
    eventId: 'event:entry-submitted',
    runId: started.runId,
    type: 'entry_submitted',
    approvedByUser: true,
    sourceRef: 'proof:entry:receipt-001',
    at: '2026-07-18T10:12:00+09:00',
  })
  assert(result.state === 'entry_submitted', 'state=' + result.state)
  const row = db.prepare('SELECT status, submitted FROM selection WHERE id = ?').get(started.selectionId) as {
    status: string
    submitted: number
  }
  assert(row.status === '出願済' && row.submitted === 1, '選考状態が更新されていません')
})

check('ES本文をDB入力へ混ぜると拒否する', () => {
  const material = {
    key: 'motivation',
    question: '志望動機',
    sourceRef: 'private-ledger:motivation',
    contentHash: 'a'.repeat(64),
    charCount: 400,
    content: '保存してはいけない本文',
  } as ApplicationMaterialInput & { content: string }
  expectThrow(() => applyApplicationEvent(db, {
    eventId: 'event:es-raw-denied',
    runId: started.runId,
    type: 'es_filled',
    materials: [material],
  }), /ES本文はDBへ渡せません/)
})

check('ES転記だけでは提出済みにしない', () => {
  const isolated = openDb(':memory:')
  try {
    const direct = startApplication(isolated, {
      company: '未提出テスト株式会社',
      position: '28卒開発職',
      materialsRef: 'private-ledger:unsubmitted',
      sourceRef: 'test:unsubmitted:start',
    })
    applyApplicationEvent(isolated, {
      eventId: 'test:unsubmitted:filled',
      runId: direct.runId,
      type: 'es_filled',
      materials: [{
        key: 'motivation',
        question: '志望動機',
        sourceRef: 'private-ledger:unsubmitted:motivation',
        contentHash: 'd'.repeat(64),
        charCount: 200,
      }],
    })
    const row = isolated.prepare('SELECT status, submitted FROM selection WHERE id = ?').get(direct.selectionId) as {
      status: string
      submitted: number
    }
    assert(row.status === '出願予定' && row.submitted === 0, '転記だけで提出扱いになりました')
  } finally {
    isolated.close()
  }
})

check('ESはメタデータだけを保存する', () => {
  const result = applyApplicationEvent(db, {
    eventId: 'event:es-filled',
    runId: started.runId,
    type: 'es_filled',
    at: '2026-07-18T10:20:00+09:00',
    materials: [{
      key: 'motivation',
      question: '志望動機',
      sourceRef: 'private-ledger:motivation',
      contentHash: 'b'.repeat(64),
      charCount: 398,
      charLimit: 400,
    }],
  })
  assert(result.state === 'es_review', 'state=' + result.state)
  const columns = db.prepare('PRAGMA table_info(application_material)').all() as { name: string }[]
  assert(!columns.some((column) => /body|content$|answer|draft/i.test(column.name)), '本文用の列があります')
  const event = db.prepare("SELECT data_json AS dataJson FROM application_event WHERE id = 'event:es-filled'")
    .get() as { dataJson: string }
  assert(!event.dataJson.includes('志望動機') && !event.dataJson.includes('private-ledger'), 'イベントへ本文情報が漏れています')
})

check('同じイベントIDは二重反映しない', () => {
  const result = applyApplicationEvent(db, {
    eventId: 'event:es-filled',
    runId: started.runId,
    type: 'es_filled',
    materials: [{
      key: 'other',
      question: '別設問',
      sourceRef: 'private-ledger:other',
      contentHash: 'c'.repeat(64),
      charCount: 100,
    }],
  })
  assert(!result.applied, '重複イベントを適用しました')
  const count = db.prepare('SELECT COUNT(*) AS n FROM application_material').get() as { n: number }
  assert(count.n === 1, '重複イベントでmaterialが増えました')
})

check('本人承認後のES提出を記録する', () => {
  const result = applyApplicationEvent(db, {
    eventId: 'event:es-submitted',
    runId: started.runId,
    type: 'es_submitted',
    approvedByUser: true,
    sourceRef: 'proof:es:receipt-001',
    at: '2026-07-18T10:30:00+09:00',
  })
  assert(result.state === 'es_submitted', 'state=' + result.state)
})

check('適性検査の問題・解答入力を拒否する', () => {
  const unsafe = {
    testType: 'テスト形式',
    answers: ['A'],
  } as AssessmentInput & { answers: string[] }
  expectThrow(() => applyApplicationEvent(db, {
    eventId: 'event:assessment-unsafe',
    runId: started.runId,
    type: 'assessment_detected',
    assessment: unsafe,
  }), /問題・解答は扱えません/)
})

check('適性検査の準備情報と締切予定を保存する', () => {
  const result = applyApplicationEvent(db, {
    eventId: 'event:assessment-detected',
    runId: started.runId,
    type: 'assessment_detected',
    at: '2026-07-18T11:00:00+09:00',
    assessment: {
      id: 'assessment-test-001',
      testType: 'Web適性検査',
      provider: 'テスト提供元',
      url: 'https://example.test/assessment',
      deadline: '2026-08-01T18:00:00+09:00',
      durationMinutes: 60,
      allowedItems: ['筆記用具'],
      environmentStatus: '確認済み',
      sourceRef: 'proof:assessment:001',
    },
  })
  assert(result.state === 'assessment_pending' && Boolean(result.appointmentId), '検査締切を登録できません')
  assert(listWebAssessments(db).length === 1, '検査が保存されていません')
  const outbox = listCalendarOutbox(db, new Date('2026-07-18T12:00:00+09:00'))
  assert(outbox.some((item) => item.kind === 'テスト'), '締切がoutboxにありません')
})

check('適性検査完了は本人確認なしでは記録しない', () => {
  expectThrow(() => applyApplicationEvent(db, {
    eventId: 'event:assessment-completed-denied',
    runId: started.runId,
    type: 'assessment_completed',
    assessment: {
      id: 'assessment-test-001',
      testType: 'Web適性検査',
    },
  }), /本人の最終承認/)
})

check('本人の受検完了を事実として記録する', () => {
  const result = applyApplicationEvent(db, {
    eventId: 'event:assessment-completed',
    runId: started.runId,
    type: 'assessment_completed',
    approvedByUser: true,
    at: '2026-07-25T12:00:00+09:00',
    assessment: {
      id: 'assessment-test-001',
      testType: 'Web適性検査',
    },
  })
  assert(result.state === 'awaiting_interview', 'state=' + result.state)
  const row = db.prepare("SELECT status FROM web_assessment WHERE id = 'assessment-test-001'").get() as { status: string }
  assert(row.status === '本人受検済', 'status=' + row.status)
})

let interviewAppointmentId = 0
check('面接予定を登録してカレンダーoutboxへ載せる', () => {
  const result = applyApplicationEvent(db, {
    eventId: 'event:interview-scheduled',
    runId: started.runId,
    type: 'interview_scheduled',
    at: '2026-07-28T10:00:00+09:00',
    appointment: {
      at: '2026-08-10T14:00:00+09:00',
      endAt: '2026-08-10T15:00:00+09:00',
      kind: '面接',
      title: '一次面接',
      url: 'https://meet.example.test/interview',
      person: '採用担当者',
    },
  })
  interviewAppointmentId = result.appointmentId || 0
  assert(result.state === 'interview_scheduled' && interviewAppointmentId > 0, '面接予定が作成されていません')
  const outbox = listCalendarOutbox(db, new Date('2026-07-28T12:00:00+09:00'))
  assert(outbox.some((item) => item.appointmentId === interviewAppointmentId), '面接予定がoutboxにありません')
})

check('外部カレンダーIDを戻すとoutboxから外れる', () => {
  const linked = linkCalendarAppointment(db, {
    appointmentId: interviewAppointmentId,
    externalId: 'calendar-event-001',
    calendarId: 'job-hunting',
  })
  assert(linked.linked, 'linkされませんでした')
  const duplicate = linkCalendarAppointment(db, {
    appointmentId: interviewAppointmentId,
    externalId: 'calendar-event-001',
    calendarId: 'job-hunting',
  })
  assert(!duplicate.linked, '同じlinkを再処理しました')
  const outbox = listCalendarOutbox(db, new Date('2026-07-28T12:00:00+09:00'))
  assert(!outbox.some((item) => item.appointmentId === interviewAppointmentId), 'link済み予定がoutboxに残っています')
})

check('別の外部予定への付け替えを拒否する', () => {
  expectThrow(() => linkCalendarAppointment(db, {
    appointmentId: interviewAppointmentId,
    externalId: 'calendar-event-other',
  }), /別のカレンダー予定/)
})

check('一時停止中はresumeなしに進めない', () => {
  applyApplicationEvent(db, {
    eventId: 'event:paused',
    runId: started.runId,
    type: 'paused',
  })
  expectThrow(() => applyApplicationEvent(db, {
    eventId: 'event:blocked-note-progress',
    runId: started.runId,
    type: 'awaiting_interview',
  }), /先に resumed/)
  const resumed = applyApplicationEvent(db, {
    eventId: 'event:resumed',
    runId: started.runId,
    type: 'resumed',
  })
  assert(resumed.state === 'interview_scheduled', '元の状態へ戻りません')
})

check('run一覧に完了状態と参照だけが出る', () => {
  const runs = listApplicationRuns(db)
  assert(runs.length === 1 && runs[0].id === started.runId, 'run一覧が不正です')
  assert(!JSON.stringify(runs).includes('保存してはいけない本文'), '一覧へ本文が漏れています')
})

db.close()
console.log('応募自動運転テスト: ' + passed + '件成功 / ' + failed + '件失敗')
if (failed > 0) process.exit(1)
