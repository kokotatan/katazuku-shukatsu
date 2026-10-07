/**
 * 会議実行(meeting_run / career_meeting_run)の状態を確かめる・進める。
 *   npx tsx scripts/db-meeting-run.ts appointment ensure <予定ID>
 *   npx tsx scripts/db-meeting-run.ts appointment transition <予定ID> <state> [エラー文]
 *   npx tsx scripts/db-meeting-run.ts career transition <支援面談ID> <state> [エラー文]
 *
 * state: armed / opened / recording / stopping / digesting / done / failed
 * 既に先の段にいるなら手前の段の指定は何もしない。2段以上の飛び越しは失敗する(src/meeting-run.ts)。
 * 正本DBの場所は KATAZUKU_DB(省略時は <リポジトリ>/data/katazuku.db)。
 */
import { openDb } from '../src/db.js'
import { resolveDatabasePath } from '../src/database-path.js'
import {
  ensureMeetingRun,
  isMeetingRunState,
  transitionMeetingRun,
  type MeetingRunKind,
} from '../src/meeting-run.js'

const USAGE = '使い方: db-meeting-run.ts <appointment|career> <ensure|transition> <id> [state] [error]'
const [kindArg, command, idArg, state, error] = process.argv.slice(2)
const id = Number(idArg)
if ((kindArg !== 'appointment' && kindArg !== 'career') || !Number.isInteger(id) || id <= 0) throw new Error(USAGE)
const kind: MeetingRunKind = kindArg

const db = openDb(resolveDatabasePath())
try {
  if (command === 'ensure') {
    console.log(JSON.stringify(ensureMeetingRun(db, kind, id)))
  } else if (command === 'transition') {
    if (!isMeetingRunState(state)) throw new Error(USAGE)
    console.log(JSON.stringify(transitionMeetingRun(db, kind, id, state, error || '')))
  } else {
    throw new Error(USAGE)
  }
} finally {
  db.close()
}
