/**
 * anthropic-api: 利用者自身の Anthropic API キーで Claude の Messages API を呼ぶ provider。
 *
 * - ツールは持たない(文章生成だけ)。本文を埋め込んだ抽出(daily-sync)や、ツール不要の工程にだけ使われる。
 *   ツールが要る工程では preflight が capability_missing を返し、副作用前に次の provider へ回る。
 * - 「Sign in with Claude」(claude.ai ログイン)は実装しない。Anthropic は承認なしに第三者製品が
 *   claude.ai のログインや利用枠を提供することを認めていない。Claude のサブスクリプションで動かしたい場合は、
 *   利用者自身がログインしたローカルの Claude Code(provider: claude / claude-cli)を使う。
 * - 依存ゼロのため SDK ではなく fetch で呼ぶ(リポジトリのランタイム依存ゼロ方針)。
 *
 * 環境変数:
 *   ANTHROPIC_API_KEY            必須。.env(gitignore済み)に置く
 *   KATAZUKU_ANTHROPIC_MODEL     既定 claude-opus-5-5
 *   KATAZUKU_ANTHROPIC_EFFORT    low / medium / high / xhigh / max(省略時はモデル既定)
 *   KATAZUKU_ANTHROPIC_FALLBACKS 0 で安全分類器による拒否時のサーバ側フォールバックを無効化(既定は有効)
 *   ANTHROPIC_BASE_URL           既定 https://api.anthropic.com
 */
import type { AgentAdapter, ProcessResult } from '../agent-runtime.js'
import { failureForStatus, isAbortError, readSse, toProcessResult, type HttpOutcome } from './http.js'

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5'

export interface AnthropicApiOptions {
  env?: NodeJS.ProcessEnv
  fetch?: typeof fetch
}

interface StreamEvent {
  type?: string
  delta?: { type?: string; text?: string; stop_reason?: string }
  error?: { type?: string; message?: string }
}

export function buildAnthropicRequest(prompt: string, env: NodeJS.ProcessEnv): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
  const fallbacks = env.KATAZUKU_ANTHROPIC_FALLBACKS !== '0'
  const body: Record<string, unknown> = {
    model: env.KATAZUKU_ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL,
    max_tokens: 64000,
    stream: true,
    messages: [{ role: 'user', content: prompt }],
  }
  const effort = env.KATAZUKU_ANTHROPIC_EFFORT?.trim()
  if (effort) body.output_config = { effort }
  // 安全分類器が拒否したとき、同じ要求をサーバ側で別モデルへ回す(拒否カテゴリで振り分ける既定モード)
  if (fallbacks) body.fallbacks = 'default'
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-api-key': env.ANTHROPIC_API_KEY ?? '',
    'anthropic-version': '2023-06-01',
  }
  if (fallbacks) headers['anthropic-beta'] = 'server-side-fallback-2026-07-01'
  const base = (env.ANTHROPIC_BASE_URL?.trim() || 'https://api.anthropic.com').replace(/\/+$/, '')
  return { url: `${base}/v1/messages`, headers, body }
}

export async function callAnthropic(prompt: string, env: NodeJS.ProcessEnv, timeoutMs: number, request: typeof fetch = fetch): Promise<HttpOutcome> {
  const { url, headers, body } = buildAnthropicRequest(prompt, env)
  let response: Response
  try {
    response = await request(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    return { text: '', failure: isAbortError(error) ? 'timeout' : 'connection_failed', diagnostic: 'Anthropic API へ接続できません' }
  }
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => '')
    // 529 は混雑(overloaded)。一時的なので rate_limited として次の provider へ回す
    const failure = response.status === 529 ? 'rate_limited' : failureForStatus(response.status)
    return { text: '', failure, diagnostic: `Anthropic API HTTP ${response.status}: ${detail.slice(0, 300)}` }
  }
  let text = ''
  let stopReason = ''
  try {
    for await (const event of readSse(response.body)) {
      if (!event.data) continue
      let parsed: StreamEvent
      try { parsed = JSON.parse(event.data) as StreamEvent } catch { continue }
      if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') text += parsed.delta.text ?? ''
      else if (parsed.type === 'message_delta' && parsed.delta?.stop_reason) stopReason = parsed.delta.stop_reason
      else if (parsed.type === 'error') {
        const type = parsed.error?.type ?? ''
        const failure = type === 'overloaded_error' || type === 'rate_limit_error' ? 'rate_limited' : type === 'authentication_error' ? 'auth_unavailable' : 'runtime_error'
        return { text: '', failure, diagnostic: `Anthropic API ストリームエラー: ${type}` }
      }
    }
  } catch (error) {
    return { text: '', failure: isAbortError(error) ? 'timeout' : 'connection_failed', diagnostic: 'Anthropic API のストリームが途中で切れました' }
  }
  if (stopReason === 'refusal') return { text: '', failure: 'runtime_error', diagnostic: 'Anthropic API: 安全分類器により応答が拒否されました' }
  if (stopReason === 'max_tokens') return { text: '', failure: 'invalid_output', diagnostic: 'Anthropic API: 出力が上限で切れました' }
  return { text }
}

export function createAnthropicApiAdapter(options: AnthropicApiOptions = {}): AgentAdapter {
  const env = options.env ?? process.env
  return {
    id: 'anthropic-api',
    // ツールを持たない。能力を要求する工程には使わない
    capabilities: new Set<string>(),
    strictCapabilities: true,
    async preflight(request) {
      const missing = request.capabilities.find((capability) => capability)
      if (missing) return { ok: false, failure: 'capability_missing', detail: `anthropic-api はツールを持たないため ${missing} を使えません` }
      if (!env.ANTHROPIC_API_KEY?.trim()) return { ok: false, failure: 'auth_unavailable', detail: 'ANTHROPIC_API_KEY が未設定です' }
      return { ok: true }
    },
    buildInvocation(request) {
      // 表示用(dry-run)。実行は run() が行い、プロンプトは本文で送る(URLや引数に入れない)
      const { url, body } = buildAnthropicRequest('', env)
      return { command: 'POST ' + url, args: ['model=' + String(body.model)], stdin: request.prompt, cwd: request.cwd }
    },
    async run(request, _paths, timeoutMs): Promise<ProcessResult> {
      const started = Date.now()
      return toProcessResult(await callAnthropic(request.prompt, env, timeoutMs, options.fetch), started)
    },
    async readOutput(result) {
      return result.stdout
    },
    detectPossibleSideEffect() {
      return false
    },
  }
}
