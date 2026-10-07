/**
 * 正本DB側の受け口。録音機で作った面談バンドル(manifest.json 付き)を検査してからDBへ反映する。
 *
 * 守り:
 *   1. manifestのschema検証 + 実体のサイズ・sha256照合(転送・展開の欠損を検知)
 *   2. バンドル外を指すパス・途中のリンクの拒否(zip slip)
 *   3. manifestとDB反映JSONの runId / 予定ID の一致確認(取り違え防止)
 *   4. 反映は applyInterview と同じ関数・同じ1トランザクションで通す(runIdで冪等)
 *
 * 録音機上の絶対パス(transcriptPath / people[].photoPath)は正本DB側の機械には存在しない。
 * 文字起こしは保管先へ写してそのパスを記録し、顔写真は同梱スクショへ付け替える。
 * 音声はDBに入れず、反映後に保管先 <archiveRoot>/<runId>/audio/ へ置く。
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { openDb } from './db.js'
import { repositoryRoot, resolveDatabasePath } from './database-path.js'
import { applyInterview, PHOTO_ROOT, validateInterviewInput } from './db-apply-interview.js'
import {
  assertBundleMatchesInterview,
  verifyExtractedBundle,
  type InterviewBundleManifest,
} from './interview-bundle.js'

export interface InterviewBundleApplyOptions {
  /** 反映先のDB。渡さなければ dbPath(省略時は KATAZUKU_DB / 既定の正本DB)を開いて閉じる。 */
  db?: DatabaseSync
  dbPath?: string
  /** 顔写真の複製先。既定は <リポジトリ>/data/private/photos */
  photoRoot?: string
  /** 文字起こし・音声の保管先。既定は <リポジトリ>/logs/interview-archive */
  archiveRoot?: string
  /**
   * 音声をバンドルから移すか(既定 false = 複製)。複製なら同じディレクトリで再実行しても検査に通る。
   * zipを一時展開したときは、どのみち消えるので移す。
   */
  moveAudio?: boolean
}

export interface InterviewBundleApplyOutcome {
  runId: string
  created: boolean
  interviewId: number
  photos: number
  /** DBに記録した文字起こしのパス(同梱が無ければ空) */
  transcriptPath: string
  archivedAudio: string[]
  /** 反映は続けたが、本人が確かめたほうがよいこと(写真の付け替え失敗など) */
  warnings: string[]
}

/** runId をディレクトリ名に使える形へ寄せる。 */
function safeRunDirectory(runId: string): string {
  return runId.replace(/[^A-Za-z0-9._-]/g, '-')
}

/**
 * people[].photoPath を、同じファイル名の同梱スクショ(kind=shot)へ付け替える。
 * 同梱に無い写真はパスを外す(議事録の反映は続ける)。外部から届いたJSONの指す任意のパスを、
 * 正本DB側の機械で読みに行かないため。戻り値は付け替えられなかった写真の警告。
 */
export function rebaseBundlePhotoPaths(
  interview: Record<string, unknown>,
  bundleRoot: string,
  manifest: InterviewBundleManifest,
): string[] {
  const warnings: string[] = []
  if (!Array.isArray(interview.people)) return warnings
  const shots = manifest.files.filter((file) => file.kind === 'shot')
  for (const person of interview.people as Record<string, unknown>[]) {
    if (!person || typeof person !== 'object') continue
    const photoPath = typeof person.photoPath === 'string' ? person.photoPath.trim() : ''
    if (!photoPath) continue
    // 録音機がWindowsでも他OSでも、区切りを揃えてからファイル名だけを見る。
    const name = basename(photoPath.replace(/\\/g, '/'))
    const shot = shots.find((file) => basename(file.path) === name)
    if (shot) {
      person.photoPath = join(bundleRoot, shot.path)
    } else {
      delete person.photoPath
      warnings.push(`顔写真がバンドルに同梱されていないため登録しません: ${name}`)
    }
  }
  return warnings
}

/** manifest.json を読む。リンクや通常ファイル以外は拒否する。 */
export function readBundleManifest(bundleRoot: string): InterviewBundleManifest {
  const manifestPath = join(bundleRoot, 'manifest.json')
  if (!existsSync(manifestPath)) throw new Error('manifest.json がありません')
  const stat = lstatSync(manifestPath)
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('manifest.json が通常ファイルではありません')
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8')) as InterviewBundleManifest
  } catch (error) {
    throw new Error(`manifest.json を読めません: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Windowsでは同梱の tar.exe(bsdtar)を名指しする。Git for Windows 等の GNU tar が
 * PATH の先にあると zip を読めないため。
 */
function tarCommand(): string {
  if (process.platform !== 'win32') return 'tar'
  const bundled = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
  return existsSync(bundled) ? bundled : 'tar'
}

/**
 * zipを空の一時ディレクトリへ展開して、そのパスを返す。展開には OS の tar を使う
 * (Windows 10以降の tar.exe と macOS の tar は zip を読める。GNU tar しかない環境では
 * unzip 等で展開してディレクトリを渡す)。中身の安全性は verifyExtractedBundle が確かめる。
 */
export function extractBundleZip(zipPath: string): string {
  const destination = mkdtempSync(join(tmpdir(), 'katazuku-interview-bundle-'))
  const result = spawnSync(tarCommand(), ['-xf', zipPath, '-C', destination], { encoding: 'utf8' })
  if (result.status !== 0) {
    rmSync(destination, { recursive: true, force: true })
    const reason = result.error?.message || result.stderr?.trim() || `終了コード ${result.status}`
    throw new Error(`zipを展開できませんでした(${reason})。unzip等で展開し、ディレクトリを渡してください`)
  }
  return destination
}

/** 移動できなければ(別ボリューム等)コピーしてから元を消す。 */
function moveFile(from: string, to: string): void {
  try {
    renameSync(from, to)
  } catch {
    copyFileSync(from, to)
    rmSync(from, { force: true })
  }
}

/** 展開済みの面談バンドルを検査し、正本DBへ反映する。 */
export function applyInterviewBundle(bundleRoot: string, options: InterviewBundleApplyOptions = {}): InterviewBundleApplyOutcome {
  const root = isAbsolute(bundleRoot) ? resolve(bundleRoot) : resolve(process.cwd(), bundleRoot)
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`バンドルのディレクトリがありません: ${root}`)

  const manifest = readBundleManifest(root)
  const verified = verifyExtractedBundle(root, manifest)
  if (!verified.ok || !verified.dbJsonPath) {
    throw new Error('バンドルの検査に失敗しました:\n  ' + verified.errors.join('\n  '))
  }

  const interview = JSON.parse(readFileSync(verified.dbJsonPath, 'utf8')) as Record<string, unknown>
  const mismatch = assertBundleMatchesInterview(manifest, interview)
  if (mismatch.length) throw new Error('manifestとDB反映JSONが一致しません:\n  ' + mismatch.join('\n  '))
  // CLIの db-apply-interview と同じ検査を通す。関数経由でも必須項目の欠けたJSONを入れない。
  validateInterviewInput(interview)

  const archiveDir = join(options.archiveRoot ?? join(repositoryRoot(), 'logs', 'interview-archive'), safeRunDirectory(manifest.runId))

  // 文字起こしは録音機上のパスで入っている。正本DB側の保管先へ写し、そのパスを記録する。
  // 写すのは反映が成功した後(失敗したバンドルの断片を保管先に残さない)。
  const transcript = manifest.files.find((file) => file.kind === 'transcript')
  const transcriptTarget = transcript ? join(archiveDir, 'transcript', basename(transcript.path)) : ''
  if (transcriptTarget) interview.transcriptPath = transcriptTarget

  const warnings = rebaseBundlePhotoPaths(interview, root, manifest)

  const db = options.db ?? openDb(resolveDatabasePath(options.dbPath))
  let result: ReturnType<typeof applyInterview>
  try {
    result = applyInterview(interview as unknown as Parameters<typeof applyInterview>[0], db, options.photoRoot ?? PHOTO_ROOT)
  } finally {
    if (!options.db) db.close()
  }

  if (transcript) {
    mkdirSync(join(archiveDir, 'transcript'), { recursive: true })
    copyFileSync(join(root, transcript.path), transcriptTarget)
  }

  // 音声は原本として保管先へ移す。DB・スナップショットには載せない(個人データ・容量)。
  const archivedAudio: string[] = []
  const audioFiles = manifest.files.filter((file) => file.kind === 'audio')
  if (audioFiles.length) {
    mkdirSync(join(archiveDir, 'audio'), { recursive: true })
    for (const file of audioFiles) {
      const to = join(archiveDir, 'audio', basename(file.path))
      if (options.moveAudio) moveFile(join(root, file.path), to)
      else copyFileSync(join(root, file.path), to)
      archivedAudio.push(to)
    }
  }

  return {
    runId: manifest.runId,
    created: result.created,
    interviewId: result.interviewId,
    photos: result.photos,
    transcriptPath: transcriptTarget,
    archivedAudio,
    warnings,
  }
}

/**
 * zipまたは展開済みディレクトリを受け取って反映する。zipは一時ディレクトリへ展開し、
 * 反映の成否にかかわらず一時ディレクトリを片付ける(元のzipは残す)。
 */
export function applyInterviewBundleFile(path: string, options: InterviewBundleApplyOptions = {}): InterviewBundleApplyOutcome {
  const target = resolve(path)
  if (!existsSync(target)) throw new Error(`バンドルがありません: ${target}`)
  if (statSync(target).isDirectory()) return applyInterviewBundle(target, options)
  if (!target.toLowerCase().endsWith('.zip')) throw new Error(`zipか展開済みディレクトリを渡してください: ${target}`)
  const extracted = extractBundleZip(target)
  try {
    return applyInterviewBundle(extracted, { moveAudio: true, ...options })
  } finally {
    rmSync(extracted, { recursive: true, force: true })
  }
}
