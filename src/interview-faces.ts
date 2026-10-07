/**
 * 面談スクショ(<録音>-shots)から顔写真を切り出し、議事録JSONへ結び付けるファイル操作。
 * 規則そのものは src/face-crop.ts、画像の読み書きは src/png.ts。
 *
 * - cropFacesFromShots: 顔の矩形(検出器の結果か本人の指定)から face-NNN.png と faces.json を書く
 * - attachFacesToInterview: faces.json に本人が書いた対応だけを使い、people[].photoPath を付ける
 *
 * 顔写真・スクショは個人情報なので、-shots フォルダ(gitignore 済みの logs/ 配下)の外へは書かない。
 * DBへの登録は src/db-apply-interview.ts(写真の実体は data/private/photos、DBには storage_key だけ)。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { repositoryRoot } from './database-path.js'
import {
  buildFacesManifest,
  parseFaceDetections,
  parseFacesManifest,
  planFaceCrops,
  resolveFaceAssignments,
  type ExcludedFace,
  type FaceAssignment,
  type FaceCropOptions,
  type FacesManifest,
  type PlannedFace,
  type ShotDetections,
} from './face-crop.js'
import { cropImage, decodePng, encodePng, type RgbaImage } from './png.js'

export const FACES_MANIFEST = 'faces.json'

/** 録音・議事録JSON・-shots フォルダのどれを渡されても、対応する -shots フォルダを返す。 */
export function shotsDirFor(path: string): string {
  const absolute = resolve(path)
  if (existsSync(absolute) && statSync(absolute).isDirectory()) return absolute
  const name = basename(absolute)
  const stem = name.endsWith('-db.json') ? name.slice(0, -'-db.json'.length) : basename(name, extname(name)).replace(/-transcript$/, '')
  return join(dirname(absolute), `${stem}-shots`)
}

/** -shots フォルダのスクショ(切り出した face-*.png は除く)を番号順に返す。 */
export function listShots(shotsDir: string): string[] {
  if (!existsSync(shotsDir)) return []
  return readdirSync(shotsDir)
    .filter((file) => /\.png$/i.test(file) && !/^face-\d+\.png$/i.test(file))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
}

/** 本人の表示名: 設定の displayName、環境変数 KATAZUKU_MEETING_DISPLAY_NAMES(カンマ区切り)、引数。 */
export function selfDisplayNames(displayName: string | undefined, env: NodeJS.ProcessEnv = process.env, extra: string[] = []): string[] {
  const fromEnv = (env.KATAZUKU_MEETING_DISPLAY_NAMES || '').split(/[,\n]/)
  return [...new Set([displayName || '', ...fromEnv, ...extra].map((name) => name.trim()).filter(Boolean))]
}

export interface FaceDetectorOptions {
  python?: string
  script?: string
  labels?: boolean
  env?: NodeJS.ProcessEnv
}

/**
 * 任意導入の検出器(scripts/detect-faces.py。OpenCV)を呼ぶ。
 * 使えなければ理由つきで例外にする(呼び出し側は「顔写真は保留」として扱う)。
 */
export function runFaceDetector(images: string[], options: FaceDetectorOptions = {}): ShotDetections[] {
  const env = options.env ?? process.env
  const python = options.python || env.KATAZUKU_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
  const script = options.script ?? join(repositoryRoot(), 'scripts', 'detect-faces.py')
  const result = spawnSync(python, [script, ...images, ...(options.labels ? ['--labels'] : [])], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true, env: { ...env, PYTHONIOENCODING: 'utf-8' },
  })
  if (result.error) throw new Error(`顔検出器を起動できません(${python}。Python は KATAZUKU_PYTHON で指定できます): ${result.error.message}`)
  if (result.status !== 0) throw new Error(`顔検出器が失敗しました: ${(result.stderr || '').trim().split(/\r?\n/).pop() || `終了コード ${result.status}`}`)
  const last = (result.stdout || '').trim().split(/\r?\n/).pop() || ''
  try {
    return parseFaceDetections(JSON.parse(last))
  } catch (error) {
    throw new Error(`顔検出器の出力が読めません: ${(error as Error).message}`)
  }
}

export interface CropFacesResult {
  shotsDir: string
  manifestPath: string
  faces: PlannedFace[]
  excluded: ExcludedFace[]
  /** faces.json が既にあり、作り直さなかった */
  skipped: boolean
}

function readManifest(path: string): FacesManifest | undefined {
  if (!existsSync(path)) return undefined
  return parseFacesManifest(JSON.parse(readFileSync(path, 'utf8')))
}

/**
 * 顔の矩形から face-NNN.png と faces.json を書く。faces.json が既にあれば、force でない限り何もしない
 * (本人が書き込んだ対応を守るため。force で作り直しても、同じ顔に書いた対応は引き継ぐ)。
 */
export function cropFacesFromShots(input: {
  shotsDir: string
  detections: ShotDetections[]
  options?: FaceCropOptions
  force?: boolean
}): CropFacesResult {
  const shotsDir = resolve(input.shotsDir)
  const manifestPath = join(shotsDir, FACES_MANIFEST)
  const previous = readManifest(manifestPath)
  if (previous && !input.force) {
    return { shotsDir, manifestPath, faces: previous.faces, excluded: previous.excluded, skipped: true }
  }
  const available = new Set(listShots(shotsDir))
  for (const shot of input.detections) {
    if (!available.has(shot.file)) throw new Error(`-shots フォルダに無いスクショです: ${shot.file}`)
  }
  const plan = planFaceCrops(input.detections, input.options)
  const images = new Map<string, RgbaImage>()
  for (const face of plan.faces) {
    let image = images.get(face.shot)
    if (!image) {
      image = decodePng(readFileSync(join(shotsDir, face.shot)))
      images.set(face.shot, image)
    }
    writeFileSync(join(shotsDir, face.file), encodePng(cropImage(image, face.crop)))
  }
  // 作り直しで数が減ったときの古い顔写真を残さない
  const keep = new Set(plan.faces.map((face) => face.file))
  for (const file of readdirSync(shotsDir)) {
    if (/^face-\d+\.png$/i.test(file) && !keep.has(file)) rmSync(join(shotsDir, file), { force: true })
  }
  const manifest = buildFacesManifest(plan, previous)
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  return { shotsDir, manifestPath, faces: plan.faces, excluded: plan.excluded, skipped: false }
}

/** 本人が指定した矩形(--box)を、画像の大きさを読んで検出結果の形にする。 */
export function detectionsFromBoxes(shotsDir: string, boxes: { file: string; face: ShotDetections['faces'][number] }[]): ShotDetections[] {
  const byFile = new Map<string, ShotDetections>()
  for (const { file, face } of boxes) {
    let shot = byFile.get(file)
    if (!shot) {
      const path = join(shotsDir, file)
      if (!existsSync(path)) throw new Error(`スクショがありません: ${path}`)
      const image = decodePng(readFileSync(path))
      shot = { file, width: image.width, height: image.height, faces: [] }
      byFile.set(file, shot)
    }
    shot.faces.push(face)
  }
  // 画像の外にはみ出した指定は parseFaceDetections と同じ規則で拒否する
  return parseFaceDetections([...byFile.values()])
}

export interface AttachFacesResult {
  dbJsonPath: string
  assignments: FaceAssignment[]
  pending: string[]
  /** photoPath を付けた・外した人物がいて、議事録JSONを書き換えた */
  changed: boolean
  interview: Record<string, unknown>
}

/**
 * faces.json(と overrides)の対応から people[].photoPath を付ける。曖昧なものは付けずに pending へ。
 * overrides は faces.json の person にも書き戻す(後から見て何を付けたか分かるように)。
 */
export function attachFacesToInterview(input: {
  dbJsonPath: string
  shotsDir?: string
  overrides?: Record<string, string>
  selfNames?: string[]
}): AttachFacesResult {
  const dbJsonPath = resolve(input.dbJsonPath)
  const shotsDir = resolve(input.shotsDir ?? shotsDirFor(dbJsonPath))
  const manifestPath = join(shotsDir, FACES_MANIFEST)
  const manifest = readManifest(manifestPath)
  if (!manifest) throw new Error(`faces.json がありません。先に npm run interview:faces -- detect で切り出します: ${manifestPath}`)
  const overrides = input.overrides ?? {}
  if (Object.keys(overrides).length) {
    for (const face of manifest.faces) if (face.file in overrides) face.person = overrides[face.file].trim()
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  }
  const interview = JSON.parse(readFileSync(dbJsonPath, 'utf8')) as Record<string, unknown>
  const people = Array.isArray(interview.people) ? (interview.people as Record<string, unknown>[]) : []
  const named = people.map((person) => ({ name: typeof person?.name === 'string' ? person.name : '' }))
  const { assignments, pending } = resolveFaceAssignments(manifest, named, {}, input.selfNames ?? [])

  const target = new Map<number, string>()
  for (const assignment of assignments) {
    const path = join(shotsDir, assignment.face)
    if (!existsSync(path)) {
      pending.push(`${assignment.face}: 画像ファイルが無いため付けない(detect --force で作り直す)`)
      continue
    }
    target.set(assignment.personIndex, path)
  }
  let changed = false
  const ours = (value: unknown) => typeof value === 'string' && resolve(dirname(value), '.') === shotsDir && /^face-\d+\.png$/i.test(basename(value))
  people.forEach((person, index) => {
    const next = target.get(index)
    if (next) {
      if (person.photoPath !== next) {
        if (typeof person.photoPath === 'string' && person.photoPath.trim() && !ours(person.photoPath)) {
          pending.push(`「${String(person.name)}」には別の写真が指定済みのため上書きしない: ${basename(String(person.photoPath))}`)
          return
        }
        person.photoPath = next
        changed = true
      }
    } else if (ours(person.photoPath)) {
      // 以前このフォルダの顔を付けたが、いまの対応では決まらない人物からは外す
      delete person.photoPath
      changed = true
    }
  })
  if (changed) writeFileSync(dbJsonPath, JSON.stringify(interview, null, 2) + '\n', 'utf8')
  return { dbJsonPath, assignments: assignments.filter((a) => target.has(a.personIndex)), pending, changed, interview }
}
