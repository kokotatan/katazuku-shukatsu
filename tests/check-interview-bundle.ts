/**
 * 面談バンドル(端末間)の検査規則の回帰テスト。
 * 実DB・実SSHは使わず、一時ディレクトリと :memory: 相当の検査だけで確認する。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertBundleMatchesInterview,
  isSafeBundlePath,
  sha256OfFile,
  validateBundleManifest,
  verifyExtractedBundle,
  type InterviewBundleManifest,
} from '../src/interview-bundle.js'

let failed = 0
function check(label: string, cond: boolean, detail = '') {
  console.log((cond ? '[OK] ' : '[NG] ') + label + (cond || !detail ? '' : ' -- ' + detail))
  if (!cond) failed++
}

// --- パス脱出の拒否 -----------------------------------------------------------
check('通常の相対パスは許可する', isSafeBundlePath('logs/interviews/a-db.json'))
check('..でバンドル外へ出るパスを拒否する', !isSafeBundlePath('../../data/katazuku.db'))
check('途中の..も拒否する', !isSafeBundlePath('logs/../../etc/passwd'))
check('絶対パスを拒否する', !isSafeBundlePath('/etc/passwd'))
check('ドライブ指定を拒否する', !isSafeBundlePath('C:/Windows/System32/tar.exe'))
check('バックスラッシュを拒否する', !isSafeBundlePath('logs\\interviews\\a.json'))
check('空セグメントを拒否する', !isSafeBundlePath('logs//a.json'))

check('Windowsの代替ストリームを拒否する', !isSafeBundlePath('file.json:stream'))

// --- manifestのschema検証 -----------------------------------------------------
const base: InterviewBundleManifest = {
  schemaVersion: 1,
  runId: 'appointment-42',
  appointmentId: 42,
  careerMeetingId: 0,
  sourceHost: 'EXAMPLE-PC',
  createdAt: '2026-09-09T12:00:00+09:00',
  files: [{ path: 'interview.json', kind: 'db-json', sha256: 'a'.repeat(64), bytes: 10 }],
}
check('正しいmanifestは通る', validateBundleManifest(base).length === 0, validateBundleManifest(base).join(' / '))
check('schemaVersionが違うと落ちる', validateBundleManifest({ ...base, schemaVersion: 2 }).length > 0)
check('runIdに空白が入ると落ちる', validateBundleManifest({ ...base, runId: 'a b' }).length > 0)
check('db-jsonが無いと落ちる',
  validateBundleManifest({ ...base, files: [{ path: 'a.txt', kind: 'transcript', sha256: 'a'.repeat(64), bytes: 1 }] }).length > 0)
check('db-jsonが2件あると落ちる',
  validateBundleManifest({ ...base, files: [base.files[0], { ...base.files[0], path: 'b.json' }] }).length > 0)
check('sha256の桁が違うと落ちる',
  validateBundleManifest({ ...base, files: [{ ...base.files[0], sha256: 'abc' }] }).length > 0)
check('appointmentIdとcareerMeetingIdの同時指定を拒否する',
  validateBundleManifest({ ...base, careerMeetingId: 7 }).length > 0)
check('脱出パスを含むmanifestを拒否する',
  validateBundleManifest({ ...base, files: [{ ...base.files[0], path: '../x.json' }] }).length > 0)
check('パス重複を拒否する',
  validateBundleManifest({ ...base, files: [base.files[0], { ...base.files[0] }] }).length > 0)

// --- 展開済みバンドルの実体照合 ------------------------------------------------
const root = mkdtempSync(join(tmpdir(), 'katazuku-bundle-'))
try {
  const interviewPath = join(root, 'interview.json')
  const interview = {
    runId: 'appointment-42', appointmentId: 42, company: '会社A',
    occurredAt: '2026-09-09T10:00:00+09:00', title: 'テスト面談', summary: '要約',
  }
  writeFileSync(interviewPath, JSON.stringify(interview), 'utf8')
  mkdirSync(join(root, 'shots'), { recursive: true })
  const shotPath = join(root, 'shots', 'shot-001.png')
  writeFileSync(shotPath, 'dummy-image', 'utf8')

  const manifest: InterviewBundleManifest = {
    ...base,
    files: [
      { path: 'interview.json', kind: 'db-json', sha256: sha256OfFile(interviewPath), bytes: Buffer.byteLength(JSON.stringify(interview)) },
      { path: 'shots/shot-001.png', kind: 'shot', sha256: sha256OfFile(shotPath), bytes: Buffer.byteLength('dummy-image') },
    ],
  }
  const good = verifyExtractedBundle(root, manifest)
  check('実体とsha256が揃えば合格する', good.ok, good.errors.join(' / '))
  check('DB反映JSONの場所を返す', good.dbJsonPath === interviewPath)

  const missing = verifyExtractedBundle(root, {
    ...manifest,
    files: [...manifest.files, { path: 'shots/shot-002.png', kind: 'shot', sha256: 'b'.repeat(64), bytes: 3 }],
  })
  check('転送で欠けたファイルを検知する', !missing.ok && missing.errors.some((e) => e.includes('実体がありません')))

  const outside = mkdtempSync(join(tmpdir(), 'katazuku-bundle-outside-'))
  try {
    writeFileSync(join(outside, 'other.json'), JSON.stringify(interview))
    symlinkSync(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    const linked = verifyExtractedBundle(root, { ...base, files: [{path:'linked/other.json',kind:'db-json',sha256:sha256OfFile(interviewPath),bytes:Buffer.byteLength(JSON.stringify(interview))}] })
    check('途中のディレクトリリンクを拒否する', !linked.ok)
  } finally {
    rmSync(join(root, 'linked'), {force:true,recursive:true})
    rmSync(outside, {force:true,recursive:true})
  }

  // 内容だけ差し替わった場合(転送中の破損・別の面談の混入)を捕まえる。
  writeFileSync(shotPath, 'tampered', 'utf8')
  const tampered = verifyExtractedBundle(root, manifest)
  check('中身が変わったファイルを拒否する', !tampered.ok)

  // --- manifestとDB反映JSONの取り違え -----------------------------------------
  check('runIdが一致すれば通る', assertBundleMatchesInterview(manifest, interview).length === 0)
  check('別runIdのJSONを拒否する',
    assertBundleMatchesInterview(manifest, { ...interview, runId: 'appointment-99' }).length > 0)
  check('別予定IDのJSONを拒否する',
    assertBundleMatchesInterview(manifest, { ...interview, appointmentId: 99 }).length > 0)
  check('応募面談への支援面談ID混入を拒否する',
    assertBundleMatchesInterview(manifest, { ...interview, careerMeetingId: 7 }).length > 0)
  const supportManifest: InterviewBundleManifest = { ...manifest, runId: 'career-meeting-5', appointmentId: 0, careerMeetingId: 5 }
  check('支援面談のIDずれを拒否する',
    assertBundleMatchesInterview(supportManifest, { runId: 'career-meeting-5', careerMeetingId: 6 }).length > 0)
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log(failed === 0 ? '面談バンドル検査: 全件成功' : `面談バンドル検査: ${failed}件失敗`)
if (failed > 0) process.exit(1)
