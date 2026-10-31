import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isDigitallySilentWav } from '../src/wav-silence.js'

function wav16Mono(samples: number[]): Buffer {
  const dataBytes = samples.length * 2
  const result = Buffer.alloc(44 + dataBytes)
  result.write('RIFF', 0, 'ascii')
  result.writeUInt32LE(36 + dataBytes, 4)
  result.write('WAVE', 8, 'ascii')
  result.write('fmt ', 12, 'ascii')
  result.writeUInt32LE(16, 16)
  result.writeUInt16LE(1, 20)
  result.writeUInt16LE(1, 22)
  result.writeUInt32LE(16_000, 24)
  result.writeUInt32LE(32_000, 28)
  result.writeUInt16LE(2, 32)
  result.writeUInt16LE(16, 34)
  result.write('data', 36, 'ascii')
  result.writeUInt32LE(dataBytes, 40)
  samples.forEach((sample, index) => result.writeInt16LE(sample, 44 + index * 2))
  return result
}

const root = mkdtempSync(join(tmpdir(), 'katazuku-wav-silence-'))
try {
  const silent = join(root, 'silent.wav')
  const quantizationNoise = join(root, 'quantization.wav')
  const audible = join(root, 'audible.wav')
  const stereo = join(root, 'stereo.wav')
  const malformed = join(root, 'malformed.wav')
  writeFileSync(silent, wav16Mono([0, 0, 0, 0]))
  writeFileSync(quantizationNoise, wav16Mono([0, 1, -1, 0]))
  writeFileSync(audible, wav16Mono([0, 2, -2, 0]))
  const stereoBuffer = wav16Mono([0, 0])
  stereoBuffer.writeUInt16LE(2, 22)
  writeFileSync(stereo, stereoBuffer)
  writeFileSync(malformed, Buffer.from('not-a-wav'))

  assert.equal(isDigitallySilentWav(silent), true)
  assert.equal(isDigitallySilentWav(quantizationNoise), true)
  assert.equal(isDigitallySilentWav(audible), false)
  assert.equal(isDigitallySilentWav(stereo), false, '形式不明は音声を捨てない')
  assert.equal(isDigitallySilentWav(malformed), false, '破損ファイルも音声を捨てない')
  console.log('WAV無音判定: 16-bit PCMモノラルだけをfail-openで判定')
} finally {
  rmSync(root, { recursive: true, force: true })
}
