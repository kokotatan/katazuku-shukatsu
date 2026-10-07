/**
 * 文字起こしの決定的な部品の回帰テスト。ネットワーク・実モデル・ffmpeg は使わない。
 *   npx tsx tests/check-transcription.ts
 */
import {
  CHUNK_SECONDS,
  formatTimestamp,
  mergeSpeakerSegments,
  parseChannelCount,
  parseMcpBody,
  parseVoiceboxTranscribeResult,
  parseWhisperSegments,
  renderChunkTranscript,
  renderSegmentTranscript,
  sameTranscriptReceipt,
  selectTranscriptionBackend,
  sortChunkFiles,
  SPEAKER_LABELS,
  VOICEBOX_STARTUP_WAIT_MS,
  VoiceboxMcpClient,
  waitUntil,
  type BackendAvailability,
  type TranscriptReceipt,
} from '../src/transcription.js'

let failed = 0
function check(label: string, cond: boolean, detail = '') {
  console.log((cond ? '[OK] ' : '[NG] ') + label + (cond || !detail ? '' : ' -- ' + detail))
  if (!cond) failed++
}
function throws(action: () => unknown, pattern?: RegExp): boolean {
  try { action(); return false } catch (error) { return pattern ? pattern.test((error as Error).message) : true }
}
async function rejects(action: () => Promise<unknown>, pattern?: RegExp): Promise<boolean> {
  try { await action(); return false } catch (error) { return pattern ? pattern.test((error as Error).message) : true }
}

// --- 時刻とチャンクの並び --------------------------------------------------------
check('0秒は00:00', formatTimestamp(0) === '00:00')
check('30秒ごとの見出し', formatTimestamp(CHUNK_SECONDS * 3) === '01:30')
check('60分を超えても分を繰り上げない', formatTimestamp(75 * 60 + 30) === '75:30')
check('小数と負数は丸める', formatTimestamp(59.9) === '00:59' && formatTimestamp(-3) === '00:00')
check('チャンクは数値順(3桁を超えても落とさない)',
  JSON.stringify(sortChunkFiles(['c-010.wav', 'c-1000.wav', 'c-002.wav', 'c-999.wav'])) === JSON.stringify(['c-002.wav', 'c-010.wav', 'c-999.wav', 'c-1000.wav']))
check('チャンク以外のファイルは無視', JSON.stringify(sortChunkFiles(['c-001.wav', 'notes.txt', 'c-x.wav', 'left.wav'])) === JSON.stringify(['c-001.wav']))

// --- 30秒見出し形式の全文 ----------------------------------------------------------
{
  const rendered = renderChunkTranscript(['本日はよろしくお願いします。', '  ', '志望動機を教えてください。'])
  check('無音チャンクを数える', rendered.silent === 1)
  check('無音は1行で残す(時刻の対応を崩さない)', rendered.text.includes('[00:30] [無音]'))
  check('各チャンクに見出しがある', rendered.text.startsWith('[00:00]\n本日はよろしくお願いします。') && rendered.text.includes('[01:00]\n志望動機を教えてください。'))
  check('末尾は改行1つ', rendered.text.endsWith('。\n') && !rendered.text.endsWith('\n\n'))
}

// --- 左右の発話を時刻順に合流 ------------------------------------------------------
{
  const merged = mergeSpeakerSegments([
    { speaker: SPEAKER_LABELS.left, segments: [
      { start: 0.5, end: 3, text: 'それでは始めます。' },
      { start: 12, end: 15, text: '学生時代に力を入れたことは?' },
      { start: 20, end: 21, text: '   ' },
    ] },
    { speaker: SPEAKER_LABELS.right, segments: [
      { start: 3.2, end: 5, text: 'よろしくお願いします。' },
      { start: 12, end: 13, text: 'はい。' },
      { start: 16, end: 30, text: '研究室で装置の改良に取り組みました。' },
    ] },
  ])
  check('空の発話は捨てる', merged.length === 5)
  check('開始時刻順に並ぶ', merged.map((s) => s.start).join(',') === '0.5,3.2,12,12,16')
  check('同時刻は相手が先(トラック順)', merged[2].speaker === '相手' && merged[3].speaker === '本人')
  const text = renderSegmentTranscript(merged)
  check('話者ラベル付きの行', text.split('\n')[0] === '[00:00] [相手] それでは始めます。' && text.includes('[00:16] [本人] 研究室で装置の改良に取り組みました。'))
  check('話者なしの行', renderSegmentTranscript([{ start: 65, end: 66, text: '以上です。' }]) === '[01:05] 以上です。\n')
  check('発話が無ければ無音の1行', renderSegmentTranscript([]) === '[00:00] [無音]\n')
}

// --- faster-whisper の出力・ffprobe の出力 ----------------------------------------
check('進捗行の後の最終行JSONを読む', parseWhisperSegments('loading\n{"segments":[{"start":1,"end":2,"text":"\\u3053\\u3093\\u306b\\u3061\\u306f"}]}')[0].text === 'こんにちは')
check('segments が無ければ例外', throws(() => parseWhisperSegments('{"text":"x"}'), /segments/))
check('発話の型が違えば例外', throws(() => parseWhisperSegments('{"segments":[{"start":"0","end":1,"text":"x"}]}'), /0 番目/))
check('チャンネル数(ステレオ)', parseChannelCount('2\n') === 2)
check('チャンネル数(複数ストリームは最大)', parseChannelCount('1\r\n2\r\n') === 2)
check('チャンネル数(読めなければ0)', parseChannelCount('') === 0)

// --- 方式の選択 --------------------------------------------------------------------
{
  const none: BackendAvailability = { voiceboxReachable: false, voiceboxLaunchable: false, fasterWhisper: false }
  const pick = (request: Parameters<typeof selectTranscriptionBackend>[0], availability: Partial<BackendAvailability>, speakers = false) =>
    selectTranscriptionBackend(request, { ...none, ...availability }, { speakers })
  check('auto: 起動済みの voicebox を最優先', pick('auto', { voiceboxReachable: true, fasterWhisper: true }).backend === 'voicebox')
  check('auto: 起動待ちより faster-whisper を先に使う',
    pick('auto', { voiceboxLaunchable: true, fasterWhisper: true }).backend === 'faster-whisper')
  {
    const choice = pick('auto', { voiceboxLaunchable: true })
    check('auto: 他に無ければ voicebox を起動して待つ', choice.backend === 'voicebox' && choice.startVoicebox)
  }
  check('auto: 何も無ければ理由つきで止まる', throws(() => pick('auto', {}), /文字起こし方式/))
  check('voicebox 明示: 起動済みなら起動しない', pick('voicebox', { voiceboxReachable: true }).startVoicebox === false)
  check('voicebox 明示: faster-whisper へ黙って切り替えない', throws(() => pick('voicebox', { fasterWhisper: true }), /voicebox/))
  check('faster-whisper 明示: 無ければ導入方法つきで止まる', throws(() => pick('faster-whisper', { voiceboxReachable: true }), /pip install/))
  check('話者分離は voicebox が起動済みでも faster-whisper', pick('auto', { voiceboxReachable: true, fasterWhisper: true }, true).backend === 'faster-whisper')
  check('話者分離 + voicebox 明示は拒否', throws(() => pick('voicebox', { voiceboxReachable: true, fasterWhisper: true }, true), /faster-whisper/))
  check('未知の方式は拒否', throws(() => pick('cloud' as 'auto', { voiceboxReachable: true })))
}

// --- 起動待ち(時計を注入して実時間を待たない) -------------------------------------
{
  check('起動待ちは240秒', VOICEBOX_STARTUP_WAIT_MS === 240_000)
  let clock = 0
  const sleep = async (ms: number) => { clock += ms }
  const opensAt = (at: number) => async () => clock >= at

  const ok = await waitUntil(opensAt(90_000), { timeoutMs: VOICEBOX_STARTUP_WAIT_MS, intervalMs: 2000, now: () => clock, sleep })
  check('90秒で開くポートは待ち切る', ok && clock === 90_000)

  clock = 0
  const late = await waitUntil(opensAt(300_000), { timeoutMs: VOICEBOX_STARTUP_WAIT_MS, intervalMs: 2000, now: () => clock, sleep })
  check('期限を過ぎたら false', !late && clock === VOICEBOX_STARTUP_WAIT_MS)

  clock = 0
  let probes = 0
  const exact = await waitUntil(async () => { probes += 1; return clock >= 240_000 }, { timeoutMs: 240_000, intervalMs: 7000, now: () => clock, sleep })
  check('期限ちょうどに開いたものも最後の確認で拾う', exact && clock === 240_000)
  check('最後の待ちは期限までで切る(期限を越えて眠らない)', probes === Math.ceil(240_000 / 7000) + 1)

  clock = 0
  let calls = 0
  const immediate = await waitUntil(async () => { calls += 1; return true }, { timeoutMs: 1000, now: () => clock, sleep })
  check('既に開いていれば待たない', immediate && calls === 1 && clock === 0)
}

// --- 再利用の受領票 ----------------------------------------------------------------
{
  const receipt: TranscriptReceipt = { source: '/rec/example.wav', bytes: 1024, modifiedMs: 1700000000000, backend: 'voicebox', speakers: false }
  check('同じ元ファイル・同じ方式なら再利用', sameTranscriptReceipt({ ...receipt }, receipt))
  check('サイズが違えば作り直す', !sameTranscriptReceipt({ ...receipt, bytes: 2048 }, receipt))
  check('方式が違えば作り直す', !sameTranscriptReceipt({ ...receipt, backend: 'faster-whisper' }, receipt))
  check('話者分離の有無が違えば作り直す', !sameTranscriptReceipt({ ...receipt, speakers: true }, receipt))
  check('壊れた受領票は再利用しない', !sameTranscriptReceipt(null, receipt) && !sameTranscriptReceipt('x', receipt))
}

// --- voicebox MCP(偽のfetchで通信しない) ------------------------------------------
check('SSEの最後のdata行を読む', (parseMcpBody('event: message\ndata: {"a":1}\n\ndata: {"a":2}\n') as { a: number }).a === 2)
check('プレーンJSONも読む', (parseMcpBody('{"a":3}') as { a: number }).a === 3)
check('応答の本文を取り出す', parseVoiceboxTranscribeResult({ result: { content: [{ text: '{"text":" はい。 "}' }] } }) === 'はい。')
check('エラー応答は例外', throws(() => parseVoiceboxTranscribeResult({ error: { code: -1 } }), /失敗/))
check('isError は例外', throws(() => parseVoiceboxTranscribeResult({ result: { isError: true, content: [{ text: 'file not found' }] } }), /失敗/))
check('text が無ければ例外', throws(() => parseVoiceboxTranscribeResult({ result: { content: [{ text: '{"duration":30}' }] } }), /text/))
{
  const calls: { body: Record<string, unknown>; session?: string }[] = []
  let failNext = 1
  const fakeFetch = async (_url: string, init: { headers: Record<string, string>; body: string }) => {
    const body = JSON.parse(init.body) as Record<string, unknown>
    calls.push({ body, session: init.headers['Mcp-Session-Id'] })
    const reply = (status: number, text: string, session?: string) => ({
      ok: status < 400, status, headers: { get: (name: string) => (name === 'mcp-session-id' ? session ?? null : null) }, text: async () => text,
    })
    if (body.method === 'initialize') return reply(200, 'data: {"jsonrpc":"2.0","id":1,"result":{}}\n', 'session-example')
    if (body.method === 'notifications/initialized') return reply(202, '')
    if (failNext > 0) { failNext -= 1; return reply(503, 'busy') }
    const args = (body.params as { arguments: { audio_path: string } }).arguments
    return reply(200, JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ text: JSON.stringify({ text: `${args.audio_path}の本文` }) }] } }))
  }
  const slept: number[] = []
  const client = new VoiceboxMcpClient({ fetch: fakeFetch, sleep: async (ms) => { slept.push(ms) }, retryDelayMs: 10 })
  await client.initialize()
  const text = await client.transcribe('/work/c-000.wav')
  check('一時的な失敗は再試行して成功', text === '/work/c-000.wavの本文' && slept.length === 1)
  check('initialize 後はセッションIDを付ける', calls.slice(1).every((call) => call.session === 'session-example'))
  const tool = calls.find((call) => call.body.method === 'tools/call')?.body.params as { name: string; arguments: Record<string, string> }
  check('voicebox.transcribe を日本語・turbo で呼ぶ', tool.name === 'voicebox.transcribe' && tool.arguments.language === 'ja' && tool.arguments.model === 'turbo')

  const always = new VoiceboxMcpClient({
    fetch: async () => ({ ok: false, status: 500, headers: { get: () => null }, text: async () => 'down' }),
    sleep: async () => {}, attempts: 3,
  })
  check('試行回数を使い切ったら例外', await rejects(() => always.transcribe('/work/c-001.wav'), /3回/))
}

console.log(failed === 0 ? '文字起こし: 全件成功' : `文字起こし: ${failed}件失敗`)
if (failed > 0) process.exit(1)
