/** 面談成果物のmanifest・内容・予定IDの一致を検証する。展開処理やDB反映は実行しない。 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync, lstatSync } from 'node:fs'
import { isAbsolute, join, normalize, sep } from 'node:path'

/** manifestに載せられる成果物の種別。audioだけは任意(段階転送のため後追いになる)。 */
export type BundleFileKind = 'db-json' | 'transcript' | 'shot' | 'audio'

export interface BundleFile {
  /** バンドル展開先からの相対パス。区切りは `/` 固定。 */
  path: string
  kind: BundleFileKind
  sha256: string
  bytes: number
}

export interface InterviewBundleManifest {
  schemaVersion: 1
  /** db-apply-interview の runId と同じ。冪等化の鍵。 */
  runId: string
  /** 応募選考の予定ID。支援面談なら0。 */
  appointmentId: number
  /** 支援面談ID。応募選考なら0。 */
  careerMeetingId: number
  /** 送信元ホスト名。取り違え検知用。 */
  sourceHost: string
  createdAt: string
  files: BundleFile[]
}

const RUN_ID_PATTERN = /^[A-Za-z0-9:._-]+$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const KINDS: BundleFileKind[] = ['db-json', 'transcript', 'shot', 'audio']

/**
 * 展開先を1つのディレクトリに閉じ込める。`..` や絶対パス、ドライブ指定を弾く。
 * zipのエントリ名は送信側が作るため、受け側で必ず確認する(zip slip対策)。
 */
export function isSafeBundlePath(path: string): boolean {
  if (!path || path.length > 400) return false
  if (path.includes('\\')) return false
  if (path.startsWith('/')) return false
  if (/^[A-Za-z]:/.test(path)) return false
  if (path.includes('\0') || path.includes(':')) return false
  const segments = path.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return false
  return true
}

/** manifestの形と値を検査する。戻り値が空配列なら合格。 */
export function validateBundleManifest(value: unknown): string[] {
  const errors: string[] = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['manifestはオブジェクトです']
  const manifest = value as Record<string, unknown>

  if (manifest.schemaVersion !== 1) errors.push('schemaVersionは1です')
  const runId = String(manifest.runId ?? '')
  if (!runId) errors.push('runIdは必須です')
  else if (!RUN_ID_PATTERN.test(runId)) errors.push('runIdに使えない文字が含まれます')

  const appointmentId = manifest.appointmentId
  const careerMeetingId = manifest.careerMeetingId
  if (!Number.isInteger(appointmentId) || (appointmentId as number) < 0) errors.push('appointmentIdは0以上の整数です')
  if (!Number.isInteger(careerMeetingId) || (careerMeetingId as number) < 0) errors.push('careerMeetingIdは0以上の整数です')
  // 応募選考と支援面談は排他。両方入っていると、どちらの台帳へ書くべきか受け側で決められない。
  if (Number(appointmentId) > 0 && Number(careerMeetingId) > 0) {
    errors.push('appointmentIdとcareerMeetingIdは同時に指定できません')
  }
  if (!String(manifest.sourceHost ?? '').trim()) errors.push('sourceHostは必須です')
  const createdAt = String(manifest.createdAt ?? '')
  if (!createdAt || Number.isNaN(Date.parse(createdAt))) errors.push('createdAtはISO 8601です')

  const files = manifest.files
  if (!Array.isArray(files) || files.length === 0) {
    errors.push('filesは1件以上必要です')
    return errors
  }
  const seen = new Set<string>()
  let dbJsonCount = 0
  for (const [index, raw] of files.entries()) {
    const label = `files[${index}]`
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { errors.push(`${label}: オブジェクトです`); continue }
    const file = raw as Record<string, unknown>
    const path = String(file.path ?? '')
    if (!isSafeBundlePath(path)) errors.push(`${label}.path: バンドル外へ出るパスです`)
    else if (seen.has(path)) errors.push(`${label}.path: 重複しています`)
    else seen.add(path)
    const kind = String(file.kind ?? '') as BundleFileKind
    if (!KINDS.includes(kind)) errors.push(`${label}.kind: 未知の種別です`)
    if (kind === 'db-json') dbJsonCount++
    if (!SHA256_PATTERN.test(String(file.sha256 ?? ''))) errors.push(`${label}.sha256: 64桁の16進です`)
    if (!Number.isInteger(file.bytes) || (file.bytes as number) < 0) errors.push(`${label}.bytes: 0以上の整数です`)
  }
  // DB反映の入力が無いバンドルは、受け側で何をすべきか決まらない。
  if (dbJsonCount !== 1) errors.push('db-jsonはちょうど1件必要です')
  return errors
}

export function sha256OfFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export interface BundleVerifyResult {
  ok: boolean
  errors: string[]
  /** manifestが指すDB反映用JSONの絶対パス(検証に通ったときだけ入る)。 */
  dbJsonPath?: string
}

/**
 * 展開済みバンドルを検査する。実体の有無とsha256まで確認するので、
 * 転送や展開で欠けたファイルを「静かに無いまま」DB反映へ進めない。
 */
export function verifyExtractedBundle(bundleRoot: string, manifest: InterviewBundleManifest): BundleVerifyResult {
  const errors = validateBundleManifest(manifest)
  if (errors.length) return { ok: false, errors }
  if (!isAbsolute(bundleRoot)) return { ok: false, errors: ['bundleRootは絶対パスです'] }

  const root = normalize(bundleRoot)
  let dbJsonPath: string | undefined
  for (const file of manifest.files) {
    const absolute = normalize(join(root, file.path))
    // normalize後にrootの外へ出ていないかを最終確認する(isSafeBundlePathの二重化)。
    if (absolute !== root && !absolute.startsWith(root.endsWith(sep) ? root : root + sep)) {
      errors.push(`${file.path}: 展開先の外を指しています`)
      continue
    }
    if (!existsSync(absolute)) { errors.push(`${file.path}: 実体がありません`); continue }
    // 展開先の途中にあるリンクも拒否し、別ディレクトリの実体を読まない。
    let current = root
    let unsafe = lstatSync(root).isSymbolicLink()
    for (const part of file.path.split('/')) {
      current = join(current, part)
      if (lstatSync(current).isSymbolicLink()) { unsafe = true; break }
    }
    if (unsafe || !statSync(absolute).isFile()) { errors.push(`${file.path}: 通常ファイルではありません`); continue }
    const size = statSync(absolute).size
    if (size !== file.bytes) { errors.push(`${file.path}: サイズが違います(manifest=${file.bytes} 実体=${size})`); continue }
    if (sha256OfFile(absolute) !== file.sha256) { errors.push(`${file.path}: sha256が一致しません`); continue }
    if (file.kind === 'db-json') dbJsonPath = absolute
  }
  if (errors.length) return { ok: false, errors }
  return { ok: true, errors: [], dbJsonPath }
}

/**
 * manifestとDB反映JSONの整合を確認する。
 * 別の面談のJSONを別のrunIdのmanifestで包んで送る、という取り違えを止める。
 */
export function assertBundleMatchesInterview(manifest: InterviewBundleManifest, interview: unknown): string[] {
  const errors: string[] = []
  if (!interview || typeof interview !== 'object') return ['DB反映JSONがオブジェクトではありません']
  const value = interview as Record<string, unknown>
  if (String(value.runId ?? '') !== manifest.runId) {
    errors.push('DB反映JSONのrunIdがmanifestと一致しません')
  }
  const appointmentId = Number(value.appointmentId ?? 0)
  const careerMeetingId = Number(value.careerMeetingId ?? 0)
  if (appointmentId !== manifest.appointmentId) {
    errors.push('DB反映JSONのappointmentIdがmanifestと一致しません')
  }
  if (careerMeetingId !== manifest.careerMeetingId) {
    errors.push('DB反映JSONのcareerMeetingIdがmanifestと一致しません')
  }
  return errors
}
