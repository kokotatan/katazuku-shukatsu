/**
 * 会議実行(meeting_run / career_meeting_run)の状態機械。予定1件につき1行で、録音から議事録反映までを追う。
 *
 *   armed -> opened -> recording -> stopping -> digesting -> done
 *   どの段からでも failed へ落とせる。failed から戻すときは armed からやり直す。
 *
 * 遷移の規則:
 * - 1段ずつしか進めない(2段以上の飛び越しは例外)
 * - 同じ段への遷移は更新として扱う(last_error と updated_at を書き換える)
 * - 既に先の段にいるときに手前の段を指定しても、何もせず現在の行を返す
 *   録音機と正本DBの機械が別だと、正本側が先に進んだ後で録音機が opened から順に送ってくる。
 *   これを例外にすると、後続の議事録反映まで止まってしまう。
 * - done は終端。以後の遷移は何もしない
 */
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { ensureCareerSupportSchema } from './career-support.js'
import { transaction } from './inputs.js'

export const MEETING_RUN_ORDER = ['armed', 'opened', 'recording', 'stopping', 'digesting', 'done'] as const
export type MeetingRunState = typeof MEETING_RUN_ORDER[number] | 'failed'
/** appointment = 応募選考の予定(meeting_run)、career = 支援面談(career_meeting_run) */
export type MeetingRunKind = 'appointment' | 'career'

export interface MeetingRunRow {
  id: string
  /** appointment なら予定ID、career なら支援面談ID */
  targetId: number
  state: MeetingRunState
  openedAt: string
  recordingStartedAt: string
  endedAt: string
  digestAppliedAt: string
  lastError: string
  updatedAt: string
}

interface RunTable {
  table: 'meeting_run' | 'career_meeting_run'
  column: 'appointment_id' | 'career_meeting_id'
  /** 新しく armed を作ってよい親の行か */
  parentSql: string
  label: string
}

const TABLES: Record<MeetingRunKind, RunTable> = {
  appointment: {
    table: 'meeting_run',
    column: 'appointment_id',
    parentSql: 'SELECT id FROM appointment WHERE id = ?',
    label: '予定',
  },
  career: {
    table: 'career_meeting_run',
    column: 'career_meeting_id',
    // 完了・中止した支援面談に新しい実行を作らない。
    parentSql: "SELECT id FROM career_meeting WHERE id = ? AND status = 'scheduled'",
    label: '予定状態の支援面談',
  },
}

export function isMeetingRunState(value: unknown): value is MeetingRunState {
  return value === 'failed' || (MEETING_RUN_ORDER as readonly unknown[]).includes(value)
}

/**
 * 現在の段から next へ進めるかを決める。DBに触れない純粋関数。
 * 戻り値: 'update' = 行を書き換える / 'keep' = 何もしない。不正な遷移は例外。
 */
export function decideMeetingRunTransition(current: MeetingRunState, next: MeetingRunState): 'update' | 'keep' {
  if (!isMeetingRunState(next)) throw new Error(`不明な状態です: ${String(next)}`)
  if (current === 'done') return 'keep'
  if (next === 'failed') return 'update'
  const from = current === 'failed' ? -1 : MEETING_RUN_ORDER.indexOf(current)
  const to = MEETING_RUN_ORDER.indexOf(next)
  if (to < from) return 'keep'
  if (to > from + 1) throw new Error(`不正な状態遷移: ${current} -> ${next}`)
  return 'update'
}

function readRun(db: DatabaseSync, spec: RunTable, targetId: number): MeetingRunRow | undefined {
  return db.prepare(`
    SELECT id, ${spec.column} AS targetId, state, opened_at AS openedAt,
      recording_started_at AS recordingStartedAt, ended_at AS endedAt,
      digest_applied_at AS digestAppliedAt, last_error AS lastError, updated_at AS updatedAt
    FROM ${spec.table} WHERE ${spec.column} = ?
  `).get(targetId) as MeetingRunRow | undefined
}

function insertArmed(db: DatabaseSync, spec: RunTable, targetId: number): void {
  if (!db.prepare(spec.parentSql).get(targetId)) throw new Error(`${spec.label}が見つかりません: ${targetId}`)
  db.prepare(`INSERT OR IGNORE INTO ${spec.table} (id, ${spec.column}, state, updated_at) VALUES (?, ?, 'armed', ?)`)
    .run(randomUUID(), targetId, new Date().toISOString())
}

function prepare(db: DatabaseSync, kind: MeetingRunKind): RunTable {
  const spec = TABLES[kind]
  if (!spec) throw new Error(`不明な種別です: ${String(kind)}`)
  if (kind === 'career') ensureCareerSupportSchema(db)
  return spec
}

/** 実行行が無ければ armed で作る。あれば何もせず現在の行を返す。 */
export function ensureMeetingRun(db: DatabaseSync, kind: MeetingRunKind, targetId: number): MeetingRunRow {
  const spec = prepare(db, kind)
  return transaction(db, () => {
    const existing = readRun(db, spec, targetId)
    if (existing) return existing
    insertArmed(db, spec, targetId)
    return readRun(db, spec, targetId)!
  })
}

/** 状態を1段進める(規則はファイル冒頭)。各時刻は最初にその段へ入ったときだけ記録する。 */
export function transitionMeetingRun(
  db: DatabaseSync,
  kind: MeetingRunKind,
  targetId: number,
  next: MeetingRunState,
  error = '',
): MeetingRunRow {
  const spec = prepare(db, kind)
  if (!isMeetingRunState(next)) throw new Error(`不明な状態です: ${String(next)}`)
  return transaction(db, () => {
    let current = readRun(db, spec, targetId)
    if (!current) {
      insertArmed(db, spec, targetId)
      current = readRun(db, spec, targetId)!
    }
    if (decideMeetingRunTransition(current.state, next) === 'keep') return current
    const now = new Date().toISOString()
    db.prepare(`
      UPDATE ${spec.table} SET state = ?,
        opened_at = CASE WHEN ? = 'opened' AND opened_at = '' THEN ? ELSE opened_at END,
        recording_started_at = CASE WHEN ? = 'recording' AND recording_started_at = '' THEN ? ELSE recording_started_at END,
        ended_at = CASE WHEN ? IN ('stopping','digesting','done') AND ended_at = '' THEN ? ELSE ended_at END,
        digest_applied_at = CASE WHEN ? = 'done' AND digest_applied_at = '' THEN ? ELSE digest_applied_at END,
        last_error = ?, updated_at = ?
      WHERE ${spec.column} = ?
    `).run(next, next, now, next, now, next, now, next, now, error, now, targetId)
    return readRun(db, spec, targetId)!
  })
}
