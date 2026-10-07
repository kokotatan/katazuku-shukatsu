/**
 * 面談バンドルの正本側反映(src/interview-bundle-apply.ts)の回帰テスト。
 * 一時ディレクトリに架空の予定・議事録・スクショ・音声を作り、一時DBへ通しで反映する。
 *   npx tsx tests/check-interview-bundle-apply.ts
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/db.js'
import { applyCalendar } from '../src/db-apply-calendar.js'
import { upsertCareerMeeting } from '../src/career-support.js'
import { sha256OfFile, type BundleFileKind, type InterviewBundleManifest } from '../src/interview-bundle.js'
import {
  applyInterviewBundle,
  applyInterviewBundleFile,
  rebaseBundlePhotoPaths,
} from '../src/interview-bundle-apply.js'

let failed = 0
function check(label: string, cond: boolean, detail = '') {
  console.log((cond ? '[OK] ' : '[NG] ') + label + (cond || !detail ? '' : ' -- ' + detail))
  if (!cond) failed++
}
function errorOf(action: () => unknown): string {
  try { action(); return '' } catch (error) { return error instanceof Error ? error.message : String(error) }
}

const work = mkdtempSync(join(tmpdir(), 'katazuku-bundle-apply-'))
try {
  // --- 顔写真パスの付け替え(録音機の絶対パス -> 同梱スクショ) -----------------
  {
    const manifest = {
      files: [
        { path: 'interview.json', kind: 'db-json' },
        { path: 'shots/face-001.png', kind: 'shot' },
        { path: 'shots/face-002.png', kind: 'shot' },
      ],
    } as InterviewBundleManifest
    const interview: Record<string, unknown> = { people: [
      { name: '面接官A', photoPath: 'C:\\Users\\example\\logs\\interviews\\x-shots\\face-001.png' },
      { name: '面接官B', photoPath: '/home/example/logs/interviews/x-shots/face-002.png' },
      { name: '面接官C', photoPath: 'C:\\Users\\example\\Pictures\\other.png' },
      { name: '面接官D' },
    ] }
    const warnings = rebaseBundlePhotoPaths(interview, work, manifest)
    const people = interview.people as { photoPath?: string }[]
    check('Windowsの絶対パスを同名の同梱スクショへ付け替える', people[0].photoPath === join(work, 'shots/face-001.png'), String(people[0].photoPath))
    check('POSIXの絶対パスも同名の同梱スクショへ付け替える', people[1].photoPath === join(work, 'shots/face-002.png'), String(people[1].photoPath))
    check('同梱に無い写真はパスを外す(正本側で任意のファイルを読まない)', people[2].photoPath === undefined)
    check('外した写真は警告に残す', warnings.length === 1 && warnings[0].includes('other.png'), warnings.join(' / '))
    check('写真の無い人物はそのまま', people[3].photoPath === undefined && !('photoPath' in people[3]))
  }

  // --- 通しの反映(予定の議事録) -----------------------------------------------
  const dbPath = join(work, 'data', 'katazuku.db')
  mkdirSync(join(work, 'data'), { recursive: true })
  const db = openDb(dbPath)
  applyCalendar({ events: [{
    externalId: 'bundle-apply-example', company: '会社A', title: 'オンライン面接', kind: '面接',
    startAt: '2028-01-10T15:00:00+09:00', endAt: '2028-01-10T15:45:00+09:00', url: 'https://meet.google.com/aaa-bbbb-ccc',
  }] }, db)
  const appointmentId = Number((db.prepare('SELECT id FROM appointment').get() as { id: number }).id)
  // 録音機と正本DBの機械が別なので、正本側の実行行は armed のまま反映が届くこともある。
  db.prepare("UPDATE meeting_run SET state = 'stopping' WHERE appointment_id = ?").run(appointmentId)

  const runId = `meeting-${appointmentId}`
  const bundleRoot = join(work, 'bundle')
  const files: { path: string; kind: BundleFileKind; body: string }[] = [
    { path: 'transcript/interview-raw.txt', kind: 'transcript', body: '[00:00] 面接官A: 本日はよろしくお願いします。' },
    { path: 'shots/face-001.png', kind: 'shot', body: 'dummy-image-1' },
    { path: 'shots/shot-010.png', kind: 'shot', body: 'dummy-image-2' },
    { path: 'audio/interview.flac', kind: 'audio', body: 'dummy-audio' },
  ]
  const interview = {
    runId,
    appointmentId,
    company: '会社A',
    occurredAt: '2028-01-10T15:00:00+09:00',
    title: '一次面接',
    summary: '架空の面接の要約',
    // 録音機上の絶対パスのまま届く。正本側で付け替える。
    transcriptPath: 'C:\\Users\\example\\logs\\interviews\\interview-raw.txt',
    people: [
      { name: '面接官A', role: '人事', notes: ['質問が具体的'], photoPath: 'C:\\Users\\example\\logs\\interviews\\x-shots\\face-001.png' },
      { name: '面接官B', role: '現場', photoPath: 'C:\\Users\\example\\logs\\interviews\\x-shots\\face-404.png' },
    ],
  }
  mkdirSync(bundleRoot, { recursive: true })
  writeFileSync(join(bundleRoot, 'interview.json'), JSON.stringify(interview), 'utf8')
  for (const file of files) {
    mkdirSync(join(bundleRoot, file.path, '..'), { recursive: true })
    writeFileSync(join(bundleRoot, file.path), file.body, 'utf8')
  }
  const entries = [{ path: 'interview.json', kind: 'db-json' as BundleFileKind }, ...files].map((file) => ({
    path: file.path,
    kind: file.kind,
    sha256: sha256OfFile(join(bundleRoot, file.path)),
    bytes: statSync(join(bundleRoot, file.path)).size,
  }))
  const manifest: InterviewBundleManifest = {
    schemaVersion: 1, runId, appointmentId, careerMeetingId: 0,
    sourceHost: 'EXAMPLE-PC', createdAt: '2028-01-10T16:00:00+09:00', files: entries,
  }
  const writeManifest = (value: unknown) => writeFileSync(join(bundleRoot, 'manifest.json'), JSON.stringify(value), 'utf8')
  const photoRoot = join(work, 'photos')
  const archiveRoot = join(work, 'archive')
  const options = { db, photoRoot, archiveRoot }

  // 取り違え: manifestのrunIdが議事録JSONと違う(録音機がagent実行の台帳IDを入れてしまう事故)。
  writeManifest({ ...manifest, runId: `appointment-${appointmentId}` })
  const mismatch = errorOf(() => applyInterviewBundle(bundleRoot, options))
  check('manifestと議事録のrunId不一致を拒否する', mismatch.includes('runId'), mismatch)
  check('拒否したときはDBへ何も書かない',
    Number((db.prepare('SELECT count(*) AS n FROM interview_note').get() as { n: number }).n) === 0)

  writeManifest(manifest)
  const outcome = applyInterviewBundle(bundleRoot, options)
  check('正しいバンドルは反映される', outcome.created && outcome.runId === runId, JSON.stringify(outcome))
  const note = db.prepare('SELECT transcript_path AS transcriptPath, appointment_id AS appointmentId FROM interview_note WHERE source_ref = ?')
    .get(runId) as { transcriptPath: string; appointmentId: number } | undefined
  const expectedTranscript = join(archiveRoot, runId, 'transcript', 'interview-raw.txt')
  check('議事録は予定に紐づく', note?.appointmentId === appointmentId)
  check('文字起こしのパスを正本側の保管先へ付け替える', note?.transcriptPath === expectedTranscript, String(note?.transcriptPath))
  check('文字起こしの実体が保管先にある', existsSync(expectedTranscript) && readFileSync(expectedTranscript, 'utf8').includes('面接官A'))
  check('同梱スクショの顔写真を登録する', outcome.photos === 1, String(outcome.photos))
  check('顔写真は写真置き場へ複製される',
    Number((db.prepare('SELECT count(*) AS n FROM person_photo').get() as { n: number }).n) === 1 && existsSync(photoRoot))
  check('同梱されていない写真は警告に出る', outcome.warnings.some((warning) => warning.includes('face-404.png')), outcome.warnings.join(' / '))
  const archivedAudio = join(archiveRoot, runId, 'audio', 'interview.flac')
  check('音声は保管先へ置く', outcome.archivedAudio.length === 1 && outcome.archivedAudio[0] === archivedAudio && existsSync(archivedAudio))
  check('ディレクトリ指定では元の音声を残す', existsSync(join(bundleRoot, 'audio', 'interview.flac')))
  const run = db.prepare('SELECT state FROM meeting_run WHERE appointment_id = ?').get(appointmentId) as { state: string }
  check('反映で会議実行はdoneになる', run.state === 'done', run.state)

  const again = applyInterviewBundle(bundleRoot, options)
  check('同じバンドルの再反映は冪等(created=false)', !again.created && again.interviewId === outcome.interviewId)
  check('再反映で議事録は増えない',
    Number((db.prepare('SELECT count(*) AS n FROM interview_note').get() as { n: number }).n) === 1)

  // 転送中に中身が変わったバンドルは検査で止まる。
  writeFileSync(join(bundleRoot, 'shots', 'shot-010.png'), 'tampered', 'utf8')
  const tampered = errorOf(() => applyInterviewBundle(bundleRoot, options))
  check('中身が変わったバンドルを拒否する', tampered.includes('検査に失敗'), tampered)
  writeFileSync(join(bundleRoot, 'shots', 'shot-010.png'), 'dummy-image-2', 'utf8')

  // 必須項目の欠けた議事録は、manifestが正しくても入れない。
  const brokenRoot = join(work, 'broken')
  mkdirSync(brokenRoot, { recursive: true })
  const broken = { runId: 'meeting-9999', appointmentId: 0, careerMeetingId: 0, occurredAt: '2028-01-10T15:00:00+09:00', title: '', summary: '' }
  writeFileSync(join(brokenRoot, 'interview.json'), JSON.stringify(broken), 'utf8')
  writeFileSync(join(brokenRoot, 'manifest.json'), JSON.stringify({
    ...manifest, runId: 'meeting-9999', appointmentId: 0,
    files: [{ path: 'interview.json', kind: 'db-json', sha256: sha256OfFile(join(brokenRoot, 'interview.json')), bytes: statSync(join(brokenRoot, 'interview.json')).size }],
  }), 'utf8')
  check('必須項目の欠けた議事録を拒否する', errorOf(() => applyInterviewBundle(brokenRoot, options)).includes('必須'))

  // 支援面談の議事録も同じ入口で反映できる。
  const meeting = upsertCareerMeeting(db, {
    externalId: 'career-bundle-example', organization: '支援組織A', title: 'オンライン面談', kind: '面談',
    startAt: '2028-01-11T10:00:00+09:00', endAt: '2028-01-11T10:30:00+09:00', url: 'https://meet.google.com/aaa-bbbb-ccc',
    recordable: true, status: 'scheduled',
  })
  const careerRoot = join(work, 'career')
  mkdirSync(careerRoot, { recursive: true })
  const careerRunId = `career-meeting-${meeting.id}`
  writeFileSync(join(careerRoot, 'interview.json'), JSON.stringify({
    runId: careerRunId, careerMeetingId: meeting.id, contextKind: 'career_support', organization: '支援組織A',
    occurredAt: '2028-01-11T10:00:00+09:00', title: '初回面談', summary: '架空の支援面談の要約',
  }), 'utf8')
  writeFileSync(join(careerRoot, 'manifest.json'), JSON.stringify({
    ...manifest, runId: careerRunId, appointmentId: 0, careerMeetingId: meeting.id,
    files: [{ path: 'interview.json', kind: 'db-json', sha256: sha256OfFile(join(careerRoot, 'interview.json')), bytes: statSync(join(careerRoot, 'interview.json')).size }],
  }), 'utf8')
  const career = applyInterviewBundle(careerRoot, options)
  const careerStatus = db.prepare('SELECT status FROM career_meeting WHERE id = ?').get(meeting.id) as { status: string }
  check('支援面談のバンドルも反映され、面談は完了になる', career.created && careerStatus.status === 'completed', careerStatus.status)
  db.close()

  // --- zipからの反映(OS同梱のtarがzipを読める環境だけ) ---------------------
  const systemTar = process.platform === 'win32' ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
  const zipPath = join(work, 'bundle.zip')
  const zipped = (process.platform === 'win32' && !existsSync(systemTar))
    ? { status: 1 }
    : spawnSync(systemTar, ['-a', '-cf', zipPath, '-C', bundleRoot, '.'], { encoding: 'utf8' })
  const readable = zipped.status === 0 && spawnSync(systemTar, ['-tf', zipPath], { encoding: 'utf8' }).status === 0
  if (readable) {
    const zipDbPath = join(work, 'data', 'zip.db')
    const zipDb = openDb(zipDbPath)
    applyCalendar({ events: [{
      externalId: 'bundle-apply-example', company: '会社A', title: 'オンライン面接', kind: '面接',
      startAt: '2028-01-10T15:00:00+09:00', endAt: '2028-01-10T15:45:00+09:00', url: 'https://meet.google.com/aaa-bbbb-ccc',
    }] }, zipDb)
    zipDb.close()
    const fromZip = applyInterviewBundleFile(zipPath, { dbPath: zipDbPath, photoRoot, archiveRoot: join(work, 'archive-zip') })
    check('zipを展開して反映できる', fromZip.created && fromZip.archivedAudio.length === 1, JSON.stringify(fromZip))
    check('反映後もzipは残る', existsSync(zipPath))
  } else {
    console.log('[SKIP] zipを読めるtarが無いため、zipからの反映は確かめない')
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}

console.log(failed === 0 ? '面談バンドル反映: 全件成功' : `面談バンドル反映: ${failed}件失敗`)
if (failed > 0) process.exit(1)
