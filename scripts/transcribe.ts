/**
 * 録音を文字起こしだけする(エージェントもDBも使わない)。
 *
 *   npm run transcribe -- <録音(wav/mp3/m4a/flac/mp4 など)> [--backend auto|voicebox|faster-whisper]
 *                         [--speakers] [--out <出力.txt>] [--force] [--keep-work]
 *
 * 出力は既定で logs/interviews/<元の名前>-transcript.txt。議事録化まで進めるなら
 * npm run interview:digest。前提と方式の違いは docs/TRANSCRIPTION.md。
 */
import { parseArgs } from 'node:util'
import { transcribeAudio } from '../src/transcribe-audio.js'
import type { TranscriptionBackendRequest } from '../src/transcription.js'

const USAGE = '使い方: npm run transcribe -- <録音> [--backend auto|voicebox|faster-whisper] [--speakers] [--out <txt>] [--force] [--keep-work]'

let parsed
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      backend: { type: 'string', default: 'auto' },
      speakers: { type: 'boolean', default: false },
      out: { type: 'string' },
      force: { type: 'boolean', default: false },
      'keep-work': { type: 'boolean', default: false },
    },
  })
} catch (error) {
  console.error((error as Error).message)
  console.error(USAGE)
  process.exit(1)
}

const input = parsed.positionals[0]
const backend = parsed.values.backend as TranscriptionBackendRequest
if (!input || !['auto', 'voicebox', 'faster-whisper'].includes(backend)) {
  console.error(USAGE)
  process.exit(1)
}

try {
  const result = await transcribeAudio({
    input,
    output: parsed.values.out,
    backend,
    speakers: parsed.values.speakers,
    force: parsed.values.force,
    keepWork: parsed.values['keep-work'],
  })
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.error((error as Error).message)
  process.exit(1)
}
