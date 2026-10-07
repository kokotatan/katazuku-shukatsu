/**
 * 録音後の自動議事録化(interview-autopilot)の判定規則の回帰テスト。
 * 時刻と状態は注入する。録音・文字起こし・エージェント・ネットワークは使わない。
 *   npx tsx tests/check-interview-autopilot.ts
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AUTOPILOT_DEFAULTS,
  decideRecording,
  digestArguments,
  emptyAutopilotState,
  isRecordingFile,
  parseAutopilotState,
  parseRecordingSidecar,
  recordingFinished,
  recordOutcome,
  type RecordingCandidate,
} from '../src/interview-autopilot.js'

let failed = 0
function check(label: string, cond: boolean, detail = '') {
  console.log((cond ? '[OK] ' : '[NG] ') + label + (cond || !detail ? '' : ' -- ' + detail))
  if (!cond) failed++
}
function throws(action: () => unknown): boolean {
  try { action(); return false } catch { return true }
}

const NOW = Date.parse('2026-01-01T12:00:00+09:00')
const MIN = 60_000
function candidate(overrides: Partial<RecordingCandidate> = {}): RecordingCandidate {
  return { name: 'example-2026-01-01_1000.wav', path: '/tmp/example-2026-01-01_1000.wav', size: 5 * 1024 * 1024, mtimeMs: NOW - 2 * MIN, stopMarker: false, ...overrides }
}

// --- 対象のファイル ------------------------------------------------------------------
check('録音の拡張子を対象にする', isRecordingFile('a.wav') && isRecordingFile('a.FLAC') && isRecordingFile('a.m4a') && isRecordingFile('a.mp4'))
check('録り直しの断片・結合中の一時ファイルは対象にしない', !isRecordingFile('a.part2.wav') && !isRecordingFile('a.joining.wav') && !isRecordingFile('a.tmp.wav'))
check('文字起こしや記録は対象にしない', !isRecordingFile('a-transcript.txt') && !isRecordingFile('a.recording.json') && !isRecordingFile('a-db.json'))

// --- 録音の隣の記録 --------------------------------------------------------------------
{
  const sidecar = parseRecordingSidecar('﻿' + JSON.stringify({ schemaVersion: 1, appointmentId: 42, startIso: '2026-01-01T10:00:00+09:00', endIso: '2026-01-01T11:00:00+09:00', stopAfterIso: '2026-01-01T11:16:00+09:00', pid: 1234 }))
  check('記録を読む(BOM付きでも)', sidecar.appointmentId === 42 && sidecar.pid === 1234 && sidecar.stopAfterIso === '2026-01-01T11:16:00+09:00')
  const bad = parseRecordingSidecar(JSON.stringify({ appointmentId: -3, careerMeetingId: 7, startIso: 'not a date', pid: 0 }))
  check('読めない値は捨てる', bad.appointmentId === undefined && bad.careerMeetingId === 7 && bad.startIso === undefined && bad.pid === undefined)
  check('予定IDと支援面談IDが両方あれば予定IDを使う', parseRecordingSidecar(JSON.stringify({ appointmentId: 1, careerMeetingId: 2 })).careerMeetingId === undefined)
  check('JSONでなければ例外(呼び出し側で目印なしとして扱う)', throws(() => parseRecordingSidecar('{')))
}

// --- 録り終わりの判定 ------------------------------------------------------------------
{
  const stopAfter = new Date(NOW - 5 * MIN).toISOString()
  check('書き込み中は待つ', !recordingFinished(candidate({ mtimeMs: NOW - 10_000, stopMarker: true }), NOW).finished)
  check('停止の目印があり、書き込みが止まっていれば終わり', recordingFinished(candidate({ stopMarker: true }), NOW).finished)
  check('録音プロセスが動いていれば終了予定を過ぎても待つ',
    !recordingFinished(candidate({ sidecar: { stopAfterIso: stopAfter, pid: 1 }, pidAlive: true }), NOW).finished)
  check('終了予定を大きく過ぎたら、居るように見えるPID(再利用)は無視する',
    recordingFinished(candidate({ sidecar: { stopAfterIso: new Date(NOW - AUTOPILOT_DEFAULTS.pidGraceMs - MIN).toISOString(), pid: 1 }, pidAlive: true }), NOW).finished)
  check('録音プロセスが終わっていれば終了予定の前でも終わり(手で止めた)',
    recordingFinished(candidate({ sidecar: { stopAfterIso: new Date(NOW + 30 * MIN).toISOString(), pid: 1 }, pidAlive: false }), NOW).finished)
  check('PIDの無い記録は終了予定で判断する',
    recordingFinished(candidate({ sidecar: { stopAfterIso: stopAfter } }), NOW).finished &&
    !recordingFinished(candidate({ sidecar: { stopAfterIso: new Date(NOW + MIN).toISOString() } }), NOW).finished)
  check('目印の無い録音は長く伸びていなければ終わり',
    recordingFinished(candidate({ mtimeMs: NOW - AUTOPILOT_DEFAULTS.quietMs }), NOW).finished &&
    !recordingFinished(candidate({ mtimeMs: NOW - 5 * MIN }), NOW).finished)
}

// --- 処理するかの判断(冪等・小さすぎる録音・失敗の試し直し) ------------------------------
{
  const finished = candidate({ stopMarker: true })
  check('録り終わった録音は処理する', decideRecording(finished, undefined, NOW).action === 'process')
  check('録り終わる前は待つ', decideRecording(candidate(), undefined, NOW).action === 'wait')
  check('小さすぎる録音は議事録化しない', decideRecording(candidate({ stopMarker: true, size: 50 * 1024 }), undefined, NOW).action === 'too-small')

  const state = emptyAutopilotState()
  recordOutcome(state, finished, 'done', new Date(NOW), { dbJsonPath: '/tmp/x-db.json' })
  check('同じ録音を二度処理しない', decideRecording(finished, state.recordings[finished.name], NOW).action === 'skip')
  check('録音が変わった(大きさ・更新時刻)なら処理し直す', decideRecording({ ...finished, size: finished.size + 1 }, state.recordings[finished.name], NOW).action === 'process')

  const failedState = emptyAutopilotState()
  const first = recordOutcome(failedState, finished, 'failed', new Date(NOW - 5 * MIN), { reason: 'x' })
  check('失敗の回数を数える', first.attempts === 1 && first.status === 'failed')
  check('失敗の直後は間を置く', decideRecording(finished, failedState.recordings[finished.name], NOW).action === 'wait')
  check('間を置いたら試し直す', decideRecording(finished, failedState.recordings[finished.name], NOW + AUTOPILOT_DEFAULTS.retryAfterMs).action === 'process')
  recordOutcome(failedState, finished, 'failed', new Date(NOW))
  const third = recordOutcome(failedState, finished, 'failed', new Date(NOW))
  check('上限まで失敗したら止める', third.attempts === 3 && decideRecording(finished, third, NOW + 10 * AUTOPILOT_DEFAULTS.retryAfterMs).action === 'skip')
  check('別の録音になれば失敗回数は数え直す', recordOutcome(failedState, { ...finished, mtimeMs: finished.mtimeMs + 1 }, 'failed', new Date(NOW)).attempts === 1)

  const skipped = emptyAutopilotState()
  recordOutcome(skipped, { ...finished, size: 10 }, 'skipped', new Date(NOW), { reason: '小さすぎる' })
  check('対象外と記録した録音は見に行かない', decideRecording({ ...finished, size: 10 }, skipped.recordings[finished.name], NOW).action === 'skip')

  check('状態ファイルを読み書きできる', parseAutopilotState(JSON.stringify(state)).recordings[finished.name].status === 'done' &&
    parseAutopilotState(undefined).schemaVersion === 1 && throws(() => parseAutopilotState('{"schemaVersion":2}')))
}

// --- interview:digest に渡す引数 -------------------------------------------------------
{
  const withAppointment = candidate({ sidecar: { appointmentId: 42, startIso: '2026-01-01T10:00:00+09:00' } })
  check('予定IDと開始時刻を渡し、--apply を付ける',
    JSON.stringify(digestArguments(withAppointment, 'apply', { db: '/tmp/x.db' })) ===
    JSON.stringify([withAppointment.path, '--appointment', '42', '--occurred-at', '2026-01-01T10:00:00+09:00', '--apply', '--db', '/tmp/x.db']))
  check('バンドルと議事録だけのときは --apply を付けない',
    !digestArguments(withAppointment, 'bundle').includes('--apply') && !digestArguments(withAppointment, 'minutes').includes('--apply'))
  check('支援面談IDを渡す', digestArguments(candidate({ sidecar: { careerMeetingId: 7 } }), 'minutes').join(' ').includes('--career-meeting 7'))
  check('記録が無ければ録音だけを渡す', JSON.stringify(digestArguments(candidate(), 'minutes', { backend: 'faster-whisper', speakers: true })) ===
    JSON.stringify([candidate().path, '--backend', 'faster-whisper', '--speakers']))
}

// --- 実行の1回分(dry-run。議事録化は起動しない) --------------------------------------------
{
  const work = mkdtempSync(join(tmpdir(), 'katazuku-autopilot-'))
  try {
    const dir = join(work, 'interviews')
    mkdirSync(dir)
    writeFileSync(join(dir, 'finished-2026-01-01_1000.wav'), Buffer.alloc(300 * 1024))
    writeFileSync(join(dir, 'finished-2026-01-01_1000.stop'), '')
    writeFileSync(join(dir, 'tiny-2026-01-01_1100.wav'), Buffer.alloc(1024))
    writeFileSync(join(dir, 'tiny-2026-01-01_1100.stop'), '')
    const old = new Date(Date.now() - 5 * MIN)
    for (const name of ['finished-2026-01-01_1000.wav', 'tiny-2026-01-01_1100.wav']) {
      spawnSync(process.execPath, ['-e', `require('node:fs').utimesSync(${JSON.stringify(join(dir, name))}, new Date(${old.getTime()}), new Date(${old.getTime()}))`])
    }
    const run = spawnSync(process.execPath, [join('node_modules', 'tsx', 'dist', 'cli.mjs'), join('scripts', 'interview-autopilot.ts'), '--dir', dir, '--apply', '--dry-run'], { encoding: 'utf8' })
    check('dry-run は成功する', run.status === 0, run.stderr)
    check('dry-run は録り終わった録音を処理対象として示す', /処理する: finished-2026-01-01_1000\.wav/.test(run.stderr) && /--apply/.test(run.stderr), run.stderr)
    check('dry-run は小さすぎる録音を対象外と示す', /議事録化しない: tiny-2026-01-01_1100\.wav/.test(run.stderr), run.stderr)
    const both = spawnSync(process.execPath, [join('node_modules', 'tsx', 'dist', 'cli.mjs'), join('scripts', 'interview-autopilot.ts'), '--apply', '--bundle', '--dry-run'], { encoding: 'utf8' })
    check('--apply と --bundle の同時指定は拒否', both.status === 1 && /同時/.test(both.stderr))
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

if (failed) {
  console.error(`\n${failed} 件失敗`)
  process.exit(1)
}
console.log('\ninterview-autopilot: すべて成功')
