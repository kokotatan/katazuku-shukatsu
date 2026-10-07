/**
 * 面談スクショから相手の顔写真を切り出し、議事録JSONの people[].photoPath に付ける。
 *
 *   npm run interview:faces -- detect <録音 | <名前>-shots> [--detections <json>] [--box <スクショ>:x,y,w,h[:表示名]]...
 *       [--self-name <表示名>]... [--labels] [--min-size <px>] [--margin <割合>] [--force]
 *   npm run interview:faces -- attach <名前>-db.json [--shots <dir>] [--map face-001=<名前>]...
 *       [--self-name <表示名>]... [--apply [--db <path>]]
 *
 * detect: 顔の矩形を得て(既定は任意導入の scripts/detect-faces.py。--detections / --box なら検出器を使わない)、
 *         <名前>-shots/face-NNN.png と faces.json を書く。本人の表示名のタイルと小さすぎる顔は外す。
 * attach: faces.json の "person"(と --map)に本人が書いた対応だけを使って photoPath を付ける。
 *         曖昧な対応は付けずに「要確認」として表示する。--apply ならこの機械の正本DBへ登録する
 *         (反映済みの議事録でも、顔写真だけが追加で登録される)。
 *
 * 終了コード: 0 成功 / 1 入力の誤り・失敗 / 2 検出器が使えない(opencv-python 未導入など)
 * 流れと前提は docs/TRANSCRIPTION.md「顔写真」。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { applyInterview, type InterviewInput } from '../src/db-apply-interview.js'
import { openDb } from '../src/db.js'
import { repositoryRoot, resolveDatabasePath } from '../src/database-path.js'
import { FACE_DEFAULTS, parseBoxArgument, parseFaceDetections, type ShotDetections } from '../src/face-crop.js'
import {
  attachFacesToInterview,
  cropFacesFromShots,
  detectionsFromBoxes,
  listShots,
  runFaceDetector,
  selfDisplayNames,
  shotsDirFor,
} from '../src/interview-faces.js'
import { loadConfig } from '../src/katazuku-config.js'

const ROOT = repositoryRoot()
if (existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'))
const USAGE = [
  '使い方: npm run interview:faces -- detect <録音 | <名前>-shots> [--detections <json>] [--box <スクショ>:x,y,w,h[:表示名]]...',
  '        [--self-name <表示名>]... [--labels] [--min-size <px>] [--margin <割合>] [--force]',
  '        npm run interview:faces -- attach <名前>-db.json [--shots <dir>] [--map face-001=<名前>]... [--apply [--db <path>]]',
].join('\n')

function fail(message: string, code = 1): never {
  console.error(message)
  process.exit(code)
}

let parsed
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      detections: { type: 'string' },
      box: { type: 'string', multiple: true },
      'self-name': { type: 'string', multiple: true },
      labels: { type: 'boolean', default: false },
      'min-size': { type: 'string' },
      margin: { type: 'string' },
      force: { type: 'boolean', default: false },
      shots: { type: 'string' },
      map: { type: 'string', multiple: true },
      apply: { type: 'boolean', default: false },
      db: { type: 'string' },
    },
  })
} catch (error) {
  fail(`${(error as Error).message}\n${USAGE}`)
}
const values = parsed.values
const [command, target] = parsed.positionals
if (!command || !target || !['detect', 'attach'].includes(command)) fail(USAGE)
if (values.db && !values.apply) fail('--db は --apply と一緒に指定します')

let displayName: string | undefined
try {
  displayName = loadConfig(ROOT).profile.displayName
} catch {
  displayName = undefined // 設定ファイルが無くても --self-name と環境変数で動かせる
}
const selfNames = selfDisplayNames(displayName, process.env, values['self-name'] ?? [])

function number(text: string | undefined, fallback: number, label: string): number {
  if (text === undefined) return fallback
  const value = Number(text)
  if (!Number.isFinite(value) || value < 0) fail(`${label}は0以上の数です: ${text}`)
  return value
}

if (command === 'detect') {
  const shotsDir = shotsDirFor(target)
  const shots = listShots(shotsDir)
  if (!shots.length) {
    console.error(`スクショがないため顔写真は作りません: ${shotsDir}`)
    process.exit(0)
  }
  let detections: ShotDetections[]
  try {
    if (values.detections) {
      detections = parseFaceDetections(JSON.parse(readFileSync(resolve(values.detections), 'utf8')))
    } else if (values.box?.length) {
      detections = detectionsFromBoxes(shotsDir, values.box.map(parseBoxArgument))
    } else {
      if (existsSync(join(shotsDir, 'faces.json')) && !values.force) {
        console.error(`faces.json が既にあるため作り直しません(作り直すなら --force): ${join(shotsDir, 'faces.json')}`)
        process.exit(0)
      }
      try {
        detections = runFaceDetector(shots.map((file) => join(shotsDir, file)), { labels: values.labels })
      } catch (error) {
        fail(`${(error as Error).message}\n検出器を使わないなら --box <スクショ>:x,y,w,h で顔の範囲を指定します`, 2)
      }
    }
    const result = cropFacesFromShots({
      shotsDir,
      detections,
      force: values.force,
      options: {
        selfNames,
        minSize: number(values['min-size'], FACE_DEFAULTS.minSize, '--min-size'),
        margin: number(values.margin, FACE_DEFAULTS.margin, '--margin'),
      },
    })
    if (result.skipped) {
      console.error(`faces.json が既にあるため作り直しません(作り直すなら --force): ${result.manifestPath}`)
    } else {
      console.error(`顔写真 ${result.faces.length}枚: ${result.shotsDir}`)
      const self = result.excluded.filter((face) => face.reason === 'self').length
      const small = result.excluded.filter((face) => face.reason === 'small').length
      if (self || small) console.error(`除外: 本人のタイル ${self}件 / 小さすぎる顔 ${small}件`)
      if (!selfNames.length) console.error('[要確認] 本人の表示名が未設定のため、本人の顔も候補に含まれます(設定の profile.displayName か --self-name)')
      if (result.faces.length) {
        console.error(`[要確認] 各 face-NNN.png が誰か、${result.manifestPath} の "person" に議事録の人物名を書いてから attach します`)
      }
    }
    console.log(JSON.stringify({ shotsDir: result.shotsDir, manifestPath: result.manifestPath, faces: result.faces.map((face) => face.file), skipped: result.skipped }, null, 2))
  } catch (error) {
    fail((error as Error).message)
  }
} else {
  const overrides: Record<string, string> = {}
  for (const item of values.map ?? []) {
    const match = item.match(/^(face-\d{3,}\.png|face-\d{3,}|\d{1,})=(.*)$/)
    if (!match) fail(`--map は face-001=<名前> の形で指定します: ${item}`)
    const key = /^\d+$/.test(match[1]) ? `face-${match[1].padStart(3, '0')}.png` : match[1].endsWith('.png') ? match[1] : `${match[1]}.png`
    overrides[key] = match[2]
  }
  try {
    const result = attachFacesToInterview({ dbJsonPath: target, shotsDir: values.shots, overrides, selfNames })
    for (const assignment of result.assignments) console.error(`付けた: ${assignment.face} -> ${assignment.personName}`)
    for (const line of result.pending) console.error(`[要確認] ${line}`)
    let applied: ReturnType<typeof applyInterview> | undefined
    if (values.apply) {
      const db = openDb(resolveDatabasePath(values.db))
      try {
        applied = applyInterview(result.interview as unknown as InterviewInput, db)
      } finally {
        db.close()
      }
      console.error(`正本DBへ登録した顔写真: ${applied.photos}枚`)
    }
    console.log(JSON.stringify({ dbJsonPath: result.dbJsonPath, attached: result.assignments.length, pending: result.pending.length, changed: result.changed, applied: applied ?? null }, null, 2))
  } catch (error) {
    fail((error as Error).message)
  }
}
