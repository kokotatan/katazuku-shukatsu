/**
 * 会議実行(meeting_run / career_meeting_run)の遷移規則の回帰テスト。
 * 実DBは使わず、インメモリDBと架空の予定だけで確認する。
 *   npx tsx tests/check-meeting-run.ts
 */
import { openDb } from '../src/db.js'
import { applyCalendar } from '../src/db-apply-calendar.js'
import { upsertCareerMeeting } from '../src/career-support.js'
import {
  decideMeetingRunTransition,
  ensureMeetingRun,
  transitionMeetingRun,
  type MeetingRunKind,
  type MeetingRunState,
} from '../src/meeting-run.js'

let failed = 0
function check(label: string, cond: boolean, detail = '') {
  console.log((cond ? '[OK] ' : '[NG] ') + label + (cond || !detail ? '' : ' -- ' + detail))
  if (!cond) failed++
}
function throws(action: () => unknown): boolean {
  try { action(); return false } catch { return true }
}

// --- 純粋関数の規則 -----------------------------------------------------------
check('1段進めるのは更新', decideMeetingRunTransition('armed', 'opened') === 'update')
check('同じ段は更新', decideMeetingRunTransition('recording', 'recording') === 'update')
check('手前の段は何もしない', decideMeetingRunTransition('stopping', 'opened') === 'keep')
check('doneの後は何もしない', decideMeetingRunTransition('done', 'digesting') === 'keep')
check('doneの後はfailedも何もしない', decideMeetingRunTransition('done', 'failed') === 'keep')
check('どの段からでもfailedへ落とせる', decideMeetingRunTransition('recording', 'failed') === 'update')
check('failedからはarmedでやり直せる', decideMeetingRunTransition('failed', 'armed') === 'update')
check('failedから途中の段へは飛べない', throws(() => decideMeetingRunTransition('failed', 'opened')))
check('2段以上の飛び越しは例外', throws(() => decideMeetingRunTransition('armed', 'recording')))
check('未知の状態は例外', throws(() => decideMeetingRunTransition('armed', 'paused' as MeetingRunState)))

// --- DB上の遷移(応募選考の予定と支援面談の両方) ------------------------------
const startAt = '2028-01-10T15:00:00+09:00'
const endAt = '2028-01-10T15:45:00+09:00'
const url = 'https://meet.google.com/aaa-bbbb-ccc'

function scenario(kind: MeetingRunKind) {
  const db = openDb(':memory:')
  try {
    let targetId: number
    if (kind === 'appointment') {
      applyCalendar({ events: [{
        externalId: 'meeting-run-example', company: '会社A', title: 'オンライン面接', kind: '面接', startAt, endAt, url,
      }] }, db)
      targetId = Number((db.prepare('SELECT id FROM appointment').get() as { id: number }).id)
    } else {
      targetId = upsertCareerMeeting(db, {
        externalId: 'career-run-example', organization: '支援組織A', title: 'オンライン面談', kind: '面談',
        startAt, endAt, url, recordable: true, status: 'scheduled',
      }).id
    }
    const label = kind === 'appointment' ? '予定' : '支援面談'

    const armed = ensureMeetingRun(db, kind, targetId)
    check(`${label}: ensureはarmedの行を返す`, armed.state === 'armed' && armed.targetId === targetId)
    check(`${label}: ensureの再実行で行は増えない`, ensureMeetingRun(db, kind, targetId).id === armed.id)

    const opened = transitionMeetingRun(db, kind, targetId, 'opened')
    check(`${label}: openedへ進み時刻が入る`, opened.state === 'opened' && opened.openedAt !== '')
    const reopened = transitionMeetingRun(db, kind, targetId, 'opened', '再接続')
    check(`${label}: 同じ段は更新し、最初の時刻は保つ`,
      reopened.state === 'opened' && reopened.lastError === '再接続' && reopened.openedAt === opened.openedAt)

    transitionMeetingRun(db, kind, targetId, 'recording')
    const stopping = transitionMeetingRun(db, kind, targetId, 'stopping')
    check(`${label}: stoppingで終了時刻が入る`, stopping.state === 'stopping' && stopping.endedAt !== '')

    // 録音機が正本側より遅れて opened から順に送ってくる場合。例外にせず現在の行をそのまま返す。
    const backward = transitionMeetingRun(db, kind, targetId, 'opened')
    check(`${label}: 手前の段の指定は何もしない`,
      backward.state === 'stopping' && backward.updatedAt === stopping.updatedAt, JSON.stringify(backward))
    check(`${label}: 飛び越しは例外`, throws(() => transitionMeetingRun(db, kind, targetId, 'done')))
    check(`${label}: 例外の後も状態は変わらない`, transitionMeetingRun(db, kind, targetId, 'recording').state === 'stopping')

    transitionMeetingRun(db, kind, targetId, 'digesting')
    const done = transitionMeetingRun(db, kind, targetId, 'done')
    check(`${label}: doneで反映時刻が入る`, done.state === 'done' && done.digestAppliedAt !== '')
    check(`${label}: doneの後のfailedは何もしない`, transitionMeetingRun(db, kind, targetId, 'failed', 'x').state === 'done')

    check(`${label}: 存在しないIDは例外`, throws(() => transitionMeetingRun(db, kind, 9999, 'opened')))
  } finally {
    db.close()
  }
}
scenario('appointment')
scenario('career')

// 支援面談は予定状態でなければ新しい実行を作らない(完了・中止の面談を録音対象へ戻さない)。
{
  const db = openDb(':memory:')
  try {
    const cancelled = upsertCareerMeeting(db, {
      externalId: 'career-cancelled-example', organization: '支援組織A', title: 'オンライン面談', kind: '面談',
      startAt, endAt, url, status: 'cancelled',
    })
    check('中止した支援面談には実行を作らない', throws(() => ensureMeetingRun(db, 'career', cancelled.id)))
  } finally {
    db.close()
  }
}

console.log(failed === 0 ? '会議実行の遷移: 全件成功' : `会議実行の遷移: ${failed}件失敗`)
if (failed > 0) process.exit(1)
