/**
 * 依存ゼロの最小 PNG 読み書き(面談スクショから顔を切り出すため)。
 *
 * ランタイム依存を増やさない方針なので、画像ライブラリは使わず node:zlib だけで扱う。
 * 対象は面談スクショ(System.Drawing などが書く 8bit・非インターレースの PNG)で、
 * 8bit のグレー / RGB / パレット / グレー+α / RGBA を読める。16bit とインターレースは理由を出して拒否する。
 * 書き出しは常に 8bit RGBA。切り出しの結果は入力と画素単位で一致する(決定的)。
 */
import { crc32, deflateSync, inflateSync } from 'node:zlib'

/** 8bit RGBA の画素列。data.length は width * height * 4。 */
export interface RgbaImage {
  width: number
  height: number
  data: Uint8Array
}

export interface PixelBox {
  x: number
  y: number
  w: number
  h: number
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

/** PNG を 8bit RGBA へ展開する。 */
export function decodePng(buffer: Uint8Array): RgbaImage {
  const bytes = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(SIGNATURE)) throw new Error('PNG ではありません')
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = -1
  let palette: Buffer | undefined
  let transparency: Buffer | undefined
  const idat: Buffer[] = []
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.toString('latin1', offset + 4, offset + 8)
    const start = offset + 8
    const end = start + length
    if (end + 4 > bytes.length) throw new Error(`PNG のチャンクが途中で切れています: ${type}`)
    const body = bytes.subarray(start, end)
    const expected = bytes.readUInt32BE(end)
    if (crc32(bytes.subarray(offset + 4, end)) >>> 0 !== expected) throw new Error(`PNG のチャンクが壊れています(CRC不一致): ${type}`)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      bitDepth = body[8]
      colorType = body[9]
      if (body[12] !== 0) throw new Error('インターレースの PNG には対応していません')
    } else if (type === 'PLTE') {
      palette = body
    } else if (type === 'tRNS') {
      transparency = body
    } else if (type === 'IDAT') {
      idat.push(body)
    } else if (type === 'IEND') {
      break
    }
    offset = end + 4
  }
  if (!width || !height) throw new Error('PNG の IHDR がありません')
  if (bitDepth !== 8) throw new Error(`8bit 以外の PNG には対応していません(${bitDepth}bit)`)
  const channels = CHANNELS[colorType]
  if (!channels) throw new Error(`未対応の色形式です(colorType=${colorType})`)
  if (colorType === 3 && !palette) throw new Error('パレット形式なのに PLTE がありません')

  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  if (raw.length < (stride + 1) * height) throw new Error('PNG の画素データが足りません')
  const pixels = new Uint8Array(stride * height)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]
    const source = y * (stride + 1) + 1
    const row = y * stride
    const previous = row - stride
    for (let i = 0; i < stride; i += 1) {
      const value = raw[source + i]
      const left = i >= channels ? pixels[row + i - channels] : 0
      const up = y > 0 ? pixels[previous + i] : 0
      const upLeft = y > 0 && i >= channels ? pixels[previous + i - channels] : 0
      let out: number
      if (filter === 0) out = value
      else if (filter === 1) out = value + left
      else if (filter === 2) out = value + up
      else if (filter === 3) out = value + ((left + up) >> 1)
      else if (filter === 4) out = value + paeth(left, up, upLeft)
      else throw new Error(`PNG の未知のフィルタです: ${filter}`)
      pixels[row + i] = out & 0xff
    }
  }

  const data = new Uint8Array(width * height * 4)
  for (let p = 0; p < width * height; p += 1) {
    const s = p * channels
    const d = p * 4
    if (colorType === 6) {
      data[d] = pixels[s]; data[d + 1] = pixels[s + 1]; data[d + 2] = pixels[s + 2]; data[d + 3] = pixels[s + 3]
    } else if (colorType === 2) {
      data[d] = pixels[s]; data[d + 1] = pixels[s + 1]; data[d + 2] = pixels[s + 2]; data[d + 3] = 255
    } else if (colorType === 0) {
      data[d] = data[d + 1] = data[d + 2] = pixels[s]; data[d + 3] = 255
    } else if (colorType === 4) {
      data[d] = data[d + 1] = data[d + 2] = pixels[s]; data[d + 3] = pixels[s + 1]
    } else {
      const index = pixels[s]
      if (!palette || index * 3 + 2 >= palette.length) throw new Error('パレットの範囲外の色番号があります')
      data[d] = palette[index * 3]; data[d + 1] = palette[index * 3 + 1]; data[d + 2] = palette[index * 3 + 2]
      data[d + 3] = transparency && index < transparency.length ? transparency[index] : 255
    }
  }
  return { width, height, data }
}

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(body.length, 0)
  head.write(type, 4, 'latin1')
  const tail = Buffer.alloc(4)
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0)
  return Buffer.concat([head, body, tail])
}

/**
 * 8bit RGBA の PNG を書き出す。filter は全行に同じものを使う(既定 0 = なし)。
 * 0 以外はテストで復号側の各フィルタを確かめるために使う。
 */
export function encodePng(image: RgbaImage, filter: 0 | 1 | 2 | 3 | 4 = 0): Buffer {
  const { width, height, data } = image
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error('画像の大きさが不正です')
  if (data.length !== width * height * 4) throw new Error('画素数と大きさが合いません')
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const out = y * (stride + 1)
    raw[out] = filter
    for (let i = 0; i < stride; i += 1) {
      const value = data[y * stride + i]
      const left = i >= 4 ? data[y * stride + i - 4] : 0
      const up = y > 0 ? data[(y - 1) * stride + i] : 0
      const upLeft = y > 0 && i >= 4 ? data[(y - 1) * stride + i - 4] : 0
      const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1 : paeth(left, up, upLeft)
      raw[out + 1 + i] = (value - predictor) & 0xff
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

/** 矩形を切り出す。矩形は画像の内側に収まっていること(呼び出し側で clamp する)。 */
export function cropImage(image: RgbaImage, box: PixelBox): RgbaImage {
  const { x, y, w, h } = box
  if (![x, y, w, h].every(Number.isInteger) || w <= 0 || h <= 0 || x < 0 || y < 0 || x + w > image.width || y + h > image.height) {
    throw new Error(`切り出し範囲が画像(${image.width}x${image.height})の外です: ${x},${y},${w},${h}`)
  }
  const data = new Uint8Array(w * h * 4)
  for (let row = 0; row < h; row += 1) {
    const from = ((y + row) * image.width + x) * 4
    data.set(image.data.subarray(from, from + w * 4), row * w * 4)
  }
  return { width: w, height: h, data }
}
