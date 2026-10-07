/**
 * 面談スクショから相手の顔写真を切り出し、議事録JSONの people[].photoPath へ結び付けるための規則。
 *
 * 流れ(docs/TRANSCRIPTION.md「顔写真」):
 *   1. 顔の矩形を得る。任意導入の検出器(scripts/detect-faces.py。OpenCV)か、本人が指定した矩形。
 *      このモジュールは矩形を受け取るだけで、検出器そのものには依存しない(テストでは矩形を注入する)
 *   2. planFaceCrops: 小さすぎる顔と本人のタイル(表示名が設定と一致するもの)を外し、
 *      同じ位置に何度も写る顔を1人1枚にまとめて、切り出し範囲を決める(決定的)
 *   3. 切り出した face-NNN.png と faces.json(どの顔が誰か、を本人が書く欄つき)を <録音>-shots に置く
 *   4. resolveFaceAssignments: 本人が書いた対応だけを使う。名前が見つからない・同名が複数いる・
 *      1人に複数の顔が当たっている、などの曖昧な対応は写真を付けずに「要確認」として返す
 *
 * 顔と人物の対応は推測しない。顔の見た目から誰かを当てる工程はここには無い。
 */
import type { PixelBox } from './png.js'

export interface FaceDetection extends PixelBox {
  /** 検出器の確からしさ(0..1)。手で指定した矩形は 1 */
  score?: number
  /** タイルに出ている表示名(検出器が読めたときだけ)。本人のタイルを外すのに使う */
  label?: string
}

export interface ShotDetections {
  /** スクショのファイル名(-shots フォルダ内) */
  file: string
  width: number
  height: number
  faces: FaceDetection[]
}

export interface PlannedFace {
  /** 書き出す顔写真のファイル名(face-001.png から連番) */
  file: string
  /** 切り出し元のスクショ */
  shot: string
  /** 検出された顔の矩形 */
  box: PixelBox
  /** 余白を足して画像内に収めた切り出し範囲 */
  crop: PixelBox
  score: number
  label?: string
  /** 同じ位置に写っていたスクショの枚数 */
  seenIn: number
}

export interface ExcludedFace {
  shot: string
  box: PixelBox
  reason: 'small' | 'self'
  label?: string
}

export interface FaceCropOptions {
  /** これより小さい顔(幅か高さ、px)は使わない。サムネイルや資料の写真を拾わないため */
  minSize?: number
  /** 顔の周囲に足す余白(顔の幅・高さに対する割合) */
  margin?: number
  /** 本人の表示名。タイルの表示名がこれと一致した顔は、同じ位置のものごと外す */
  selfNames?: string[]
  /** スクショをまたいで同じ人とみなす矩形の重なり(IoU) */
  sameFaceIou?: number
}

export const FACE_DEFAULTS = { minSize: 48, margin: 0.3, sameFaceIou: 0.3 } as const

export interface FacesManifest {
  schemaVersion: 1
  /** 本人への説明(faces.json を開いたときに読む) */
  howTo: string
  faces: (Omit<PlannedFace, 'seenIn'> & { seenIn: number; person: string })[]
  excluded: ExcludedFace[]
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/** 検出結果の JSON({ shots: [...] } か配列)を検査して取り出す。 */
export function parseFaceDetections(value: unknown): ShotDetections[] {
  const list = Array.isArray(value) ? value : (value as { shots?: unknown } | null)?.shots
  if (!Array.isArray(list)) throw new Error('顔検出の結果は { "shots": [...] } の形です')
  return list.map((item, index) => {
    const shot = item as Partial<ShotDetections> | null
    if (!shot || typeof shot.file !== 'string' || !shot.file.trim()) throw new Error(`shots[${index}].file がありません`)
    if (/[\\/]/.test(shot.file) || shot.file === '..') throw new Error(`shots[${index}].file はファイル名だけを書きます: ${shot.file}`)
    if (!positiveInteger(shot.width) || !positiveInteger(shot.height)) throw new Error(`shots[${index}] の width / height が不正です`)
    if (!Array.isArray(shot.faces)) throw new Error(`shots[${index}].faces は配列です`)
    const faces = shot.faces.map((face, faceIndex) => {
      const f = face as Partial<FaceDetection> | null
      if (!f || !nonNegativeInteger(f.x) || !nonNegativeInteger(f.y) || !positiveInteger(f.w) || !positiveInteger(f.h)) {
        throw new Error(`shots[${index}].faces[${faceIndex}] の矩形は 0 以上の整数の x, y と 1 以上の w, h です`)
      }
      if (f.x + f.w > shot.width! || f.y + f.h > shot.height!) throw new Error(`shots[${index}].faces[${faceIndex}] が画像の外にはみ出しています`)
      const parsed: FaceDetection = { x: f.x, y: f.y, w: f.w, h: f.h, score: typeof f.score === 'number' ? Math.max(0, Math.min(1, f.score)) : 1 }
      if (typeof f.label === 'string' && f.label.trim()) parsed.label = f.label.trim()
      return parsed
    })
    return { file: shot.file, width: shot.width, height: shot.height, faces }
  })
}

/** 本人が指定する矩形 "shot-002.png:120,80,200,200" を読む(表示名は ":名前" で足せる)。 */
export function parseBoxArgument(text: string): { file: string; face: FaceDetection } {
  const match = text.trim().match(/^([^:\\/]+\.png):(\d+),(\d+),(\d+),(\d+)(?::(.+))?$/i)
  if (!match) throw new Error(`矩形は <スクショ名>:x,y,w,h の形で指定します: ${text}`)
  const [, file, x, y, w, h, label] = match
  const face: FaceDetection = { x: Number(x), y: Number(y), w: Number(w), h: Number(h), score: 1 }
  if (face.w <= 0 || face.h <= 0) throw new Error(`矩形の幅と高さは1以上です: ${text}`)
  if (label?.trim()) face.label = label.trim()
  return { file, face }
}

/** 表示名・人物名の比較用。全角半角・大文字小文字・空白・敬称の揺れを吸収する。 */
export function normalizeName(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/gu, '').replace(/(さん|様|氏)$/u, '')
}

/** タイルの表示名が本人のものか。表示名には所属や「(自分)」が付くことがあるので包含も見る(2文字以上)。 */
export function isSelfLabel(label: string | undefined, selfNames: string[]): boolean {
  if (!label) return false
  const target = normalizeName(label)
  if (!target) return false
  return selfNames.map(normalizeName).filter((name) => name.length >= 2).some((name) => target === name || target.includes(name))
}

export function intersectionOverUnion(a: PixelBox, b: PixelBox): number {
  const left = Math.max(a.x, b.x)
  const top = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.w, b.x + b.w)
  const bottom = Math.min(a.y + a.h, b.y + b.h)
  const overlap = Math.max(0, right - left) * Math.max(0, bottom - top)
  const union = a.w * a.h + b.w * b.h - overlap
  return union > 0 ? overlap / union : 0
}

/** 顔の矩形に余白を足し、画像の内側に収める。 */
export function expandBox(box: PixelBox, margin: number, width: number, height: number): PixelBox {
  const dx = Math.round(box.w * margin)
  const dy = Math.round(box.h * margin)
  const x = Math.max(0, box.x - dx)
  const y = Math.max(0, box.y - dy)
  const right = Math.min(width, box.x + box.w + dx)
  const bottom = Math.min(height, box.y + box.h + dy)
  return { x, y, w: right - x, h: bottom - y }
}

interface Track {
  members: { shotIndex: number; shot: ShotDetections; face: FaceDetection }[]
}

/**
 * 切り出す顔を決める。同じ位置(会議画面のタイル)に写る顔はスクショをまたいで1人とみなし、
 * いちばん大きく確からしい1枚だけを残す。本人の表示名が付いた位置は、その位置ごと外す
 * (表示名が読めなかったスクショでも、同じタイルに写る本人の顔を拾わないため)。
 */
export function planFaceCrops(shots: ShotDetections[], options: FaceCropOptions = {}): { faces: PlannedFace[]; excluded: ExcludedFace[] } {
  const minSize = options.minSize ?? FACE_DEFAULTS.minSize
  const margin = options.margin ?? FACE_DEFAULTS.margin
  const sameFaceIou = options.sameFaceIou ?? FACE_DEFAULTS.sameFaceIou
  const selfNames = (options.selfNames ?? []).filter((name) => name.trim())
  const excluded: ExcludedFace[] = []
  const tracks: Track[] = []
  const ordered = [...shots].sort((a, b) => a.file.localeCompare(b.file, 'en', { numeric: true }))
  ordered.forEach((shot, shotIndex) => {
    for (const face of shot.faces) {
      if (face.w < minSize || face.h < minSize) {
        excluded.push({ shot: shot.file, box: { x: face.x, y: face.y, w: face.w, h: face.h }, reason: 'small', ...(face.label ? { label: face.label } : {}) })
        continue
      }
      let best: Track | undefined
      let bestIou = 0
      for (const track of tracks) {
        const value = Math.max(...track.members.map((member) => intersectionOverUnion(member.face, face)))
        if (value >= sameFaceIou && value > bestIou) { best = track; bestIou = value }
      }
      if (best) best.members.push({ shotIndex, shot, face })
      else tracks.push({ members: [{ shotIndex, shot, face }] })
    }
  })

  const kept: { track: Track; pick: Track['members'][number] }[] = []
  for (const track of tracks) {
    const self = track.members.find((member) => isSelfLabel(member.face.label, selfNames))
    if (self) {
      for (const member of track.members) {
        excluded.push({ shot: member.shot.file, box: { x: member.face.x, y: member.face.y, w: member.face.w, h: member.face.h }, reason: 'self', ...(member.face.label ? { label: member.face.label } : {}) })
      }
      continue
    }
    // 大きく・確からしく・先に写ったものを優先する(同点でも結果が揺れないよう順序を固定)
    const pick = [...track.members].sort((a, b) =>
      (b.face.w * b.face.h * (b.face.score ?? 1)) - (a.face.w * a.face.h * (a.face.score ?? 1))
      || a.shotIndex - b.shotIndex || a.face.x - b.face.x || a.face.y - b.face.y)[0]
    kept.push({ track, pick })
  }
  // 画面の左上から右下の順に番号を振る(本人が faces.json と画像を見比べやすいように)
  kept.sort((a, b) => a.pick.face.y - b.pick.face.y || a.pick.face.x - b.pick.face.x || a.pick.shotIndex - b.pick.shotIndex)
  const faces = kept.map(({ track, pick }, index) => {
    const label = track.members.map((member) => member.face.label).find(Boolean)
    const planned: PlannedFace = {
      file: `face-${String(index + 1).padStart(3, '0')}.png`,
      shot: pick.shot.file,
      box: { x: pick.face.x, y: pick.face.y, w: pick.face.w, h: pick.face.h },
      crop: expandBox(pick.face, margin, pick.shot.width, pick.shot.height),
      score: pick.face.score ?? 1,
      seenIn: new Set(track.members.map((member) => member.shotIndex)).size,
    }
    if (label) planned.label = label
    return planned
  })
  return { faces, excluded }
}

export const FACES_HOW_TO = [
  '各 face-NNN.png を開き、議事録JSON(<録音>-db.json)の people[].name のどれかと同じ名前を "person" に書く。',
  '分からない顔・本人の顔・資料に写った顔は空のままにする(写真は付かない)。',
  '書いたら npm run interview:faces -- attach <録音>-db.json で写真を付ける。',
].join(' ')

export function buildFacesManifest(plan: { faces: PlannedFace[]; excluded: ExcludedFace[] }, previous?: FacesManifest): FacesManifest {
  // 作り直しても、同じ切り出し元・同じ矩形の顔に本人が書いた対応は引き継ぐ
  const remembered = new Map((previous?.faces ?? []).map((face) => [`${face.shot}:${face.box.x},${face.box.y},${face.box.w},${face.box.h}`, face.person]))
  return {
    schemaVersion: 1,
    howTo: FACES_HOW_TO,
    faces: plan.faces.map((face) => ({ ...face, person: remembered.get(`${face.shot}:${face.box.x},${face.box.y},${face.box.w},${face.box.h}`) ?? '' })),
    excluded: plan.excluded,
  }
}

export function parseFacesManifest(value: unknown): FacesManifest {
  const manifest = value as Partial<FacesManifest> | null
  if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.faces)) throw new Error('faces.json の形が不正です(schemaVersion 1 と faces 配列が要ります)')
  for (const [index, face] of manifest.faces.entries()) {
    if (!face || typeof face.file !== 'string' || !/^face-\d{3,}\.png$/.test(face.file)) throw new Error(`faces[${index}].file が不正です`)
    if (face.person !== undefined && typeof face.person !== 'string') throw new Error(`faces[${index}].person は文字列です`)
  }
  return { schemaVersion: 1, howTo: manifest.howTo ?? FACES_HOW_TO, faces: manifest.faces, excluded: manifest.excluded ?? [] }
}

export interface FaceAssignment {
  personIndex: number
  personName: string
  face: string
}

/**
 * 本人が書いた対応(faces.json の person と、コマンドの --map face-001=名前)から、
 * 写真を付けてよい組だけを返す。曖昧なものは付けずに pending に理由を残す。
 */
export function resolveFaceAssignments(
  manifest: FacesManifest,
  people: { name: string }[],
  overrides: Record<string, string> = {},
  selfNames: string[] = [],
): { assignments: FaceAssignment[]; pending: string[] } {
  const pending: string[] = []
  const known = new Set(manifest.faces.map((face) => face.file))
  for (const face of Object.keys(overrides)) {
    if (!known.has(face)) pending.push(`${face} は faces.json にありません(--map を確認)`)
  }
  const byPerson = new Map<number, string[]>()
  for (const face of manifest.faces) {
    const wanted = (overrides[face.file] ?? face.person ?? '').trim()
    if (!wanted) {
      pending.push(`${face.file}: 誰の顔か未記入(${face.shot} から切り出し)`)
      continue
    }
    if (isSelfLabel(wanted, selfNames) || selfNames.some((name) => normalizeName(name) === normalizeName(wanted))) {
      pending.push(`${face.file}: 本人の名前が書かれているため写真を付けない`)
      continue
    }
    const key = normalizeName(wanted)
    const matches = people.flatMap((person, index) => (normalizeName(person.name) === key ? [index] : []))
    if (matches.length === 0) {
      pending.push(`${face.file}: 「${wanted}」は議事録の people にいない`)
      continue
    }
    if (matches.length > 1) {
      pending.push(`${face.file}: 「${wanted}」に当たる人物が議事録に${matches.length}人いて決められない`)
      continue
    }
    byPerson.set(matches[0], [...(byPerson.get(matches[0]) ?? []), face.file])
  }
  const assignments: FaceAssignment[] = []
  for (const [personIndex, faces] of [...byPerson.entries()].sort((a, b) => a[0] - b[0])) {
    const name = people[personIndex].name
    if (faces.length > 1) {
      pending.push(`「${name}」に複数の顔(${faces.join(', ')})が当たっているため、どれも付けない`)
      continue
    }
    assignments.push({ personIndex, personName: name, face: faces[0] })
  }
  return { assignments, pending }
}
