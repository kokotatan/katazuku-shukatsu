/**
 * voicebox-transcribe: チャンク済みwavをローカルVoicebox(MCP streamable HTTP)で全件文字起こしする。
 *
 * なぜスクリプトか(2026-07-29): 文字起こしは機械的な処理なのに、従来はdigest担当のLLMが
 * MCPツールを1チャンクずつ呼んでいた。Claude利用枠切れでcodexへフォールバックすると、
 * codex execは非対話のMCPツール呼び出しを「user cancelled」で自動拒否し、議事録が丸ごと
 * 止まった(リンモチ三次選考で実害)。ここで決定的に文字起こしを済ませ、LLMには
 * 構造化・話者ラベル付けだけを渡す。providerが何であっても文字起こしは壊れない。
 *
 * 使い方: npx tsx scripts/voicebox-transcribe.ts <チャンクdir> <出力txt>
 *   - <チャンクdir> の c-*.wav を連番順に voicebox.transcribe(model=turbo, ja) へかける
 *   - 出力txtは30秒ごとに [mm:ss] 見出し + Whisper生テキスト(空なら [無音])
 *   - 成功時はstdout最終行に {"chunks":N,"silent":M,"outFile":"..."} のJSONを出す
 * 接続先は env KATAZUKU_VOICEBOX_MCP_URL(既定 http://127.0.0.1:17493/mcp)。
 */
import { readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const MCP_URL = process.env.KATAZUKU_VOICEBOX_MCP_URL || 'http://127.0.0.1:17493/mcp'

function parseBody(text: string): any {
  // streamable HTTPはSSE("data: {...}")とプレーンJSONの両方がありうる
  const lines = text.split('\n').filter((l) => l.startsWith('data:'))
  if (lines.length) return JSON.parse(lines[lines.length - 1].slice(5).trim())
  return JSON.parse(text)
}

let sessionId: string | null = null
async function rpc(payload: Record<string, unknown>): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  }
  if (sessionId) headers['Mcp-Session-Id'] = sessionId
  const res = await fetch(MCP_URL, { method: 'POST', headers, body: JSON.stringify(payload) })
  const sid = res.headers.get('mcp-session-id')
  if (sid) sessionId = sid
  const text = await res.text()
  if (!res.ok) throw new Error(`voicebox MCP HTTP ${res.status}: ${text.slice(0, 200)}`)
  return text ? parseBody(text) : null
}

async function transcribeChunk(path: string): Promise<string> {
  const body = await rpc({
    jsonrpc: '2.0', id: Date.now(), method: 'tools/call',
    params: { name: 'voicebox.transcribe', arguments: { audio_path: path, language: 'ja', model: 'turbo' } },
  })
  if (body?.error) throw new Error(`voicebox.transcribe失敗: ${JSON.stringify(body.error).slice(0, 200)}`)
  const content = body?.result?.content?.[0]?.text
  if (typeof content !== 'string') throw new Error(`voicebox.transcribeの応答形式が想定外: ${JSON.stringify(body).slice(0, 200)}`)
  const parsed = JSON.parse(content)
  if (typeof parsed?.text !== 'string') throw new Error(`textが無い: ${content.slice(0, 200)}`)
  return parsed.text.trim()
}

async function main() {
  const [chunkDirArg, outFileArg] = process.argv.slice(2)
  if (!chunkDirArg || !outFileArg) {
    console.error('使い方: npx tsx scripts/voicebox-transcribe.ts <チャンクdir> <出力txt>')
    process.exit(2)
  }
  const chunkDir = resolve(chunkDirArg)
  const outFile = resolve(outFileArg)

  const init = await rpc({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: {
      protocolVersion: '2025-06-18', capabilities: {},
      clientInfo: { name: 'katazuku-voicebox-transcribe', version: '0.1' },
    },
  })
  if (init?.error) throw new Error(`voicebox MCP initialize失敗: ${JSON.stringify(init.error).slice(0, 200)}`)
  await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })
  const chunks = readdirSync(chunkDir)
    .filter((f) => /^c-\d{3}\.wav$/.test(f))
    .sort()
  if (chunks.length === 0) throw new Error(`チャンクが無い: ${chunkDir}`)

  const lines: string[] = []
  let silent = 0
  for (let i = 0; i < chunks.length; i++) {
    const mm = String(Math.floor((i * 30) / 60)).padStart(2, '0')
    const ss = String((i * 30) % 60).padStart(2, '0')
    let text = ''
    let lastError: unknown = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        text = await transcribeChunk(join(chunkDir, chunks[i]))
        lastError = null
        break
      } catch (e) {
        lastError = e
        await new Promise((r) => setTimeout(r, 2000))
      }
    }
    if (lastError) throw new Error(`${chunks[i]} の文字起こしに3回失敗: ${String(lastError)}`)
    if (!text) {
      silent++
      lines.push(`[${mm}:${ss}] [無音]`)
    } else {
      lines.push(`[${mm}:${ss}]`, text, '')
    }
    console.error(`${chunks[i]}: ${text ? text.length + '文字' : '[無音]'}`)
  }
  writeFileSync(outFile, lines.join('\n') + '\n', 'utf8')
  console.log(JSON.stringify({ chunks: chunks.length, silent, outFile }))
}

await main().catch((e) => {
  console.error(String(e?.stack || e))
  process.exit(1)
})
