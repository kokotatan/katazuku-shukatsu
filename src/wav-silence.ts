import { readFileSync } from 'node:fs'

/**
 * 16-bit PCMモノラルWAVのデジタル無音だけを確実に見分ける。
 * 形式が違う・壊れている場合はfalseに倒し、音声を捨てず通常の文字起こしへ渡す。
 */
export function isDigitallySilentWav(path: string): boolean {
  const wav = readFileSync(path)
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') return false

  let format = 0
  let channels = 0
  let bitsPerSample = 0
  let audioStart = -1
  let audioBytes = 0
  for (let offset = 12; offset + 8 <= wav.length;) {
    const size = wav.readUInt32LE(offset + 4)
    const start = offset + 8
    if (size > wav.length - start) return false
    const kind = wav.toString('ascii', offset, offset + 4)
    if (kind === 'fmt ') {
      if (size < 16) return false
      format = wav.readUInt16LE(start)
      channels = wav.readUInt16LE(start + 2)
      bitsPerSample = wav.readUInt16LE(start + 14)
    } else if (kind === 'data') {
      audioStart = start
      audioBytes = size
    }
    offset = start + size + (size & 1)
  }
  if (format !== 1 || channels !== 1 || bitsPerSample !== 16 || audioStart < 0 || audioBytes < 2 || audioBytes % 2 !== 0) return false
  for (let offset = audioStart; offset < audioStart + audioBytes; offset += 2) {
    if (Math.abs(wav.readInt16LE(offset)) > 1) return false
  }
  return true
}
