/**
 * 面談スクショからの顔写真の切り出しと、議事録JSONへの結び付けの回帰テスト。
 * 画像はすべてテスト内で合成する(実在の顔画像は使わない)。検出器(OpenCV)・ネットワークは使わず、
 * 顔の矩形は注入する。
 *   npx tsx tests/check-face-crop.ts
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/db.js'
import { applyInterview, type InterviewInput } from '../src/db-apply-interview.js'
import {
  buildFacesManifest,
  expandBox,
  intersectionOverUnion,
  isSelfLabel,
  parseBoxArgument,
  parseFaceDetections,
  planFaceCrops,
  resolveFaceAssignments,
  type FacesManifest,
  type ShotDetections,
} from '../src/face-crop.js'
import { attachFacesToInterview, cropFacesFromShots, detectionsFromBoxes, listShots, selfDisplayNames, shotsDirFor } from '../src/interview-faces.js'
import { cropImage, decodePng, encodePng, type RgbaImage } from '../src/png.js'

let failed = 0
function check(label: string, cond: boolean, detail = '') {
  console.log((cond ? '[OK] ' : '[NG] ') + label + (cond || !detail ? '' : ' -- ' + detail))
  if (!cond) failed++
}
function throws(action: () => unknown, pattern?: RegExp): boolean {
  try { action(); return false } catch (error) { return pattern ? pattern.test((error as Error).message) : true }
}

/** 座標から色が決まる合成画像。切り出し結果が元の位置と一致するかを画素で確かめられる。 */
function synthetic(width: number, height: number, seed = 0): RgbaImage {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4
      data[i] = (x * 7 + seed) & 0xff
      data[i + 1] = (y * 13 + seed) & 0xff
      data[i + 2] = (x * y + seed) & 0xff
      data[i + 3] = 255 - ((x + y) & 0x3f)
    }
  }
  return { width, height, data }
}
function samePixels(a: RgbaImage, b: RgbaImage): boolean {
  return a.width === b.width && a.height === b.height && Buffer.from(a.data).equals(Buffer.from(b.data))
}

// --- PNG の読み書き ----------------------------------------------------------------
{
  const image = synthetic(37, 23, 5)
  for (const filter of [0, 1, 2, 3, 4] as const) {
    check(`フィルタ${filter}で書いた PNG を同じ画素に戻せる`, samePixels(decodePng(encodePng(image, filter)), image))
  }
  const crop = cropImage(image, { x: 3, y: 4, w: 10, h: 6 })
  check('切り出しは元の位置の画素と一致する', crop.width === 10 && crop.height === 6 &&
    crop.data[0] === image.data[(4 * 37 + 3) * 4] && crop.data[(5 * 10 + 9) * 4 + 1] === image.data[(9 * 37 + 12) * 4 + 1])
  check('画像の外の切り出しは拒否', throws(() => cropImage(image, { x: 30, y: 0, w: 10, h: 5 }), /外/))
  check('PNG でないものは拒否', throws(() => decodePng(Buffer.from('not a png')), /PNG ではありません/))
  const broken = Buffer.from(encodePng(image))
  broken[40] ^= 0xff
  check('壊れたチャンクは CRC で拒否', throws(() => decodePng(broken), /CRC|壊れ/))
}

// --- 検出結果と矩形の指定 ------------------------------------------------------------
{
  check('矩形の指定を読む', JSON.stringify(parseBoxArgument('shot-002.png:120,80,200,210')) ===
    JSON.stringify({ file: 'shot-002.png', face: { x: 120, y: 80, w: 200, h: 210, score: 1 } }))
  check('矩形に表示名を足せる', parseBoxArgument('shot-002.png:1,2,3,4:面接官A').face.label === '面接官A')
  check('形の違う指定は拒否', throws(() => parseBoxArgument('shot-002.png:1,2,3'), /x,y,w,h/))
  check('パスを含むスクショ名は拒否', throws(() => parseBoxArgument('../x.png:1,2,3,4')))
  check('はみ出した顔は拒否', throws(() => parseFaceDetections({ shots: [{ file: 'a.png', width: 10, height: 10, faces: [{ x: 5, y: 5, w: 6, h: 2 }] }] }), /はみ出/))
  check('ファイル名以外の file は拒否', throws(() => parseFaceDetections({ shots: [{ file: 'dir/a.png', width: 10, height: 10, faces: [] }] }), /ファイル名だけ/))
  check('score は 0..1 に収める', parseFaceDetections([{ file: 'a.png', width: 10, height: 10, faces: [{ x: 0, y: 0, w: 2, h: 2, score: 3 }] }])[0].faces[0].score === 1)
}

// --- 本人の表示名・重なり・余白 -------------------------------------------------------
{
  check('表示名は空白と全角半角の揺れを吸収して一致', isSelfLabel('就活　太郎', ['就活 太郎']) && isSelfLabel('ＳＨＵＫＡＴＳＵ', ['shukatsu']))
  check('表示名に所属などが付いても本人とみなす', isSelfLabel('就活太郎(サンプル大学)', ['就活太郎']))
  check('1文字の表示名では判定しない(誤除外を防ぐ)', !isSelfLabel('A社 面接官', ['A']))
  check('表示名が無ければ本人と判定しない', !isSelfLabel(undefined, ['就活太郎']))
  check('同じ矩形の重なりは1', intersectionOverUnion({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 10, h: 10 }) === 1)
  check('離れた矩形の重なりは0', intersectionOverUnion({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 10, h: 10 }) === 0)
  check('余白は画像の内側に収める', JSON.stringify(expandBox({ x: 5, y: 5, w: 100, h: 100 }, 0.3, 120, 300)) === JSON.stringify({ x: 0, y: 0, w: 120, h: 135 }))
  check('本人の表示名は設定・環境変数・引数から重複なく集める',
    JSON.stringify(selfDisplayNames('就活 太郎', { KATAZUKU_MEETING_DISPLAY_NAMES: 'taro, 就活 太郎' }, ['T. Shukatsu'])) === JSON.stringify(['就活 太郎', 'taro', 'T. Shukatsu']))
}

// --- 切り出す顔の決め方 ----------------------------------------------------------------
const shots: ShotDetections[] = [
  { file: 'shot-001.png', width: 400, height: 300, faces: [
    { x: 40, y: 50, w: 60, h: 60, score: 0.9 },                       // 相手1(左上のタイル)
    { x: 260, y: 50, w: 60, h: 60, score: 0.95, label: '就活 太郎' },  // 本人のタイル(表示名あり)
    { x: 150, y: 200, w: 20, h: 20, score: 0.99 },                    // 資料の小さな顔写真
  ] },
  { file: 'shot-002.png', width: 400, height: 300, faces: [
    { x: 44, y: 52, w: 70, h: 70, score: 0.9 },                       // 相手1(少し大きく写った)
    { x: 262, y: 48, w: 60, h: 62, score: 0.9 },                      // 本人のタイル(表示名は読めなかった)
    { x: 40, y: 180, w: 64, h: 64, score: 0.8 },                      // 相手2
  ] },
]
{
  const plan = planFaceCrops(shots, { selfNames: ['就活太郎'] })
  check('相手の顔だけが残る(2人)', plan.faces.length === 2, JSON.stringify(plan.faces))
  check('同じ位置の顔は大きく写った1枚にまとめる', plan.faces[0].shot === 'shot-002.png' && plan.faces[0].box.w === 70 && plan.faces[0].seenIn === 2)
  check('本人のタイルは表示名が読めなかったスクショの分も外す',
    plan.excluded.filter((face) => face.reason === 'self').length === 2 && !plan.faces.some((face) => face.box.x >= 260))
  check('小さすぎる顔は外す', plan.excluded.some((face) => face.reason === 'small' && face.box.w === 20))
  check('番号は画面の上から順', plan.faces.map((face) => face.file).join(',') === 'face-001.png,face-002.png' && plan.faces[1].box.y === 180)
  check('切り出し範囲は余白つき', plan.faces[0].crop.x === 44 - 21 && plan.faces[0].crop.w === 70 + 42)
  check('同じ入力なら同じ結果(決定的)', JSON.stringify(planFaceCrops([...shots].reverse(), { selfNames: ['就活太郎'] })) === JSON.stringify(plan))
  const noSelf = planFaceCrops(shots)
  check('本人の表示名が無ければ本人のタイルも候補に残る(対応づけで止める)', noSelf.faces.length === 3)
}

// --- 顔と人物の対応 --------------------------------------------------------------------
{
  const manifest = (persons: string[]): FacesManifest => buildFacesManifest({
    faces: persons.map((_, index) => ({ file: `face-00${index + 1}.png`, shot: 'shot-001.png', box: { x: index * 10, y: 0, w: 5, h: 5 }, crop: { x: 0, y: 0, w: 5, h: 5 }, score: 1, seenIn: 1 })),
    excluded: [],
  }, { schemaVersion: 1, howTo: '', excluded: [], faces: persons.map((person, index) => ({ file: `face-00${index + 1}.png`, shot: 'shot-001.png', box: { x: index * 10, y: 0, w: 5, h: 5 }, crop: { x: 0, y: 0, w: 5, h: 5 }, score: 1, seenIn: 1, person })) })
  const people = [{ name: '面接官A' }, { name: '面接官B' }, { name: '同名C' }, { name: '同名C' }]

  const ok = resolveFaceAssignments(manifest(['面接官A', '']), people)
  check('書かれた対応だけを使う', ok.assignments.length === 1 && ok.assignments[0].personIndex === 0)
  check('未記入の顔は要確認に出す', ok.pending.some((line) => line.startsWith('face-002.png') && line.includes('未記入')))

  const ambiguous = resolveFaceAssignments(manifest(['同名C', '面接官Z']), people)
  check('同名が複数いれば付けない', ambiguous.assignments.length === 0 && ambiguous.pending.some((line) => line.includes('2人')))
  check('議事録にいない名前は付けない', ambiguous.pending.some((line) => line.includes('面接官Z')))

  const twice = resolveFaceAssignments(manifest(['面接官A', '面接官A さん']), people)
  check('1人に複数の顔が当たれば、どれも付けない', twice.assignments.length === 0 && twice.pending.some((line) => line.includes('複数の顔')))

  const self = resolveFaceAssignments(manifest(['就活太郎']), [...people, { name: '就活 太郎' }], {}, ['就活 太郎'])
  check('本人の名前を書いても写真は付けない', self.assignments.length === 0 && self.pending.some((line) => line.includes('本人')))

  const overridden = resolveFaceAssignments(manifest(['', '']), people, { 'face-002.png': '面接官B', 'face-009.png': '面接官A' })
  check('--map の対応を使う', overridden.assignments.length === 1 && overridden.assignments[0].personName === '面接官B')
  check('存在しない顔への --map は要確認', overridden.pending.some((line) => line.includes('face-009.png')))
  check('作り直しても同じ顔に書いた対応を引き継ぐ', manifest(['面接官A']).faces[0].person === '面接官A')
}

// --- ファイルを通した切り出し・結び付け・正本DBへの登録 ---------------------------------
const work = mkdtempSync(join(tmpdir(), 'katazuku-faces-'))
try {
  const interviews = join(work, 'interviews')
  const shotsDir = join(interviews, 'example-2026-01-01_1000-shots')
  mkdirSync(shotsDir, { recursive: true })
  const shotImages = [synthetic(400, 300, 1), synthetic(400, 300, 2)]
  writeFileSync(join(shotsDir, 'shot-001.png'), encodePng(shotImages[0]))
  writeFileSync(join(shotsDir, 'shot-002.png'), encodePng(shotImages[1]))
  writeFileSync(join(shotsDir, 'notes.txt'), 'スクショ以外のファイル')

  check('録音から -shots を導く', shotsDirFor(join(interviews, 'example-2026-01-01_1000.wav')) === shotsDir)
  check('議事録JSONから -shots を導く', shotsDirFor(join(interviews, 'example-2026-01-01_1000-db.json')) === shotsDir)
  check('スクショだけを番号順に並べる', listShots(shotsDir).join(',') === 'shot-001.png,shot-002.png')

  const first = cropFacesFromShots({ shotsDir, detections: shots, options: { selfNames: ['就活 太郎'] } })
  check('顔写真を2枚書く', first.faces.length === 2 && existsSync(join(shotsDir, 'face-001.png')) && existsSync(join(shotsDir, 'face-002.png')) && !existsSync(join(shotsDir, 'face-003.png')))
  const face1 = decodePng(readFileSync(join(shotsDir, 'face-001.png')))
  check('切り出した顔は元のスクショの同じ位置と一致する', samePixels(face1, cropImage(shotImages[1], first.faces[0].crop)))
  check('切り出しで face-*.png はスクショ一覧に混ざらない', listShots(shotsDir).length === 2)

  const manifestPath = join(shotsDir, 'faces.json')
  const written = JSON.parse(readFileSync(manifestPath, 'utf8')) as FacesManifest
  check('faces.json は誰の顔かを空欄で持つ', written.faces.length === 2 && written.faces.every((face) => face.person === '') && written.howTo.length > 0)

  written.faces[0].person = '面接官A'
  writeFileSync(manifestPath, JSON.stringify(written, null, 2))
  check('faces.json があれば作り直さない(本人の記入を守る)', cropFacesFromShots({ shotsDir, detections: shots }).skipped)
  const again = cropFacesFromShots({ shotsDir, detections: shots, force: true, options: { selfNames: ['就活 太郎'] } })
  const kept = JSON.parse(readFileSync(manifestPath, 'utf8')) as FacesManifest
  check('--force で作り直しても同じ顔の記入は残る', !again.skipped && kept.faces.find((face) => face.box.x === 44)?.person === '面接官A')

  check('手で指定した矩形は画像の大きさを読んで検査する',
    detectionsFromBoxes(shotsDir, [parseBoxArgument('shot-001.png:10,10,80,80')])[0].width === 400 &&
    throws(() => detectionsFromBoxes(shotsDir, [parseBoxArgument('shot-001.png:390,10,80,80')]), /はみ出/))

  const dbJsonPath = join(interviews, 'example-2026-01-01_1000-db.json')
  const interview: InterviewInput = {
    runId: 'recording-example-2026-01-01_1000',
    contextKind: 'career_support',
    organization: '支援組織A',
    occurredAt: '2026-01-01T10:00:00+09:00',
    title: '支援面談',
    summary: '(要約)',
    people: [
      { name: '面接官A', role: '担当', notes: ['(メモ)'], confidence: 0.9 },
      { name: '面接官B', role: '担当', notes: ['(メモ)'], confidence: 0.9 },
    ],
  }
  writeFileSync(dbJsonPath, JSON.stringify(interview, null, 2))

  // 1回目: 写真なしで正本DBへ反映(自動実行は顔の対応を待たずに議事録を反映する)
  const db = openDb(join(work, 'katazuku.db'))
  const photoRoot = join(work, 'photos')
  try {
    check('写真なしで先に反映できる', applyInterview(interview, db, photoRoot).created)

    const attached = attachFacesToInterview({ dbJsonPath, overrides: { 'face-002.png': '' }, selfNames: ['就活 太郎'] })
    const people = (JSON.parse(readFileSync(dbJsonPath, 'utf8')) as InterviewInput).people!
    check('対応の決まった人物に photoPath を付ける', attached.changed && people[0].photoPath === join(shotsDir, 'face-001.png'))
    check('対応の無い人物には付けない', people[1].photoPath === undefined)
    check('未記入の顔を要確認に出す', attached.pending.some((line) => line.startsWith('face-002.png')))

    const late = applyInterview(people.length ? { ...interview, people } : interview, db, photoRoot)
    check('反映済みの議事録でも、後から付けた顔写真を登録する', !late.created && late.photos === 1, JSON.stringify(late))
    const stored = db.prepare('SELECT p.name AS name, pp.storage_key AS key FROM person_photo pp JOIN person p ON p.id = pp.person_id').all() as { name: string; key: string }[]
    check('写真は対応した人物に付く', stored.length === 1 && stored[0].name === '面接官A' && existsSync(join(photoRoot, stored[0].key)))
    check('再実行しても写真は増えない', applyInterview({ ...interview, people }, db, photoRoot).photos === 0)

    // 対応を取り消すと、このフォルダの顔写真は議事録JSONから外れる
    const undone = attachFacesToInterview({ dbJsonPath, overrides: { 'face-001.png': '' } })
    const after = (JSON.parse(readFileSync(dbJsonPath, 'utf8')) as InterviewInput).people!
    check('対応を外すと photoPath も外す', undone.changed && after[0].photoPath === undefined)

    // 反映済みの議事録に結び付いていない人物には付けない(別人の写真を付けないため)
    const stranger: InterviewInput = { ...interview, people: [{ name: '面接官Z', photoPath: join(shotsDir, 'face-002.png') }] }
    check('反映済みの議事録にいない人物へは写真を登録しない', applyInterview(stranger, db, photoRoot).photos === 0)
  } finally {
    db.close()
  }
  check('faces.json が無ければ attach は止まる', throws(() => attachFacesToInterview({ dbJsonPath: join(work, 'none-db.json') }), /faces\.json/))
} finally {
  rmSync(work, { recursive: true, force: true })
}

if (failed) {
  console.error(`\n${failed} 件失敗`)
  process.exit(1)
}
console.log('\nface-crop: すべて成功')
