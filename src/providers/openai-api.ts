/**
 * openai-api: 利用者自身の OpenAI API キーで Responses API を呼ぶ provider(ツールなし・文章生成だけ)。
 *
 * ChatGPT のサブスクリプションで動かしたい場合は、こちらではなく
 * - codex(Codex CLI に本人が `codex login` でログイン)か、
 * - chatgpt-siwc(実験的: Sign in with ChatGPT で本人のプラン利用を許可)
 * を使う。
 *
 * 環境変数:
 *   OPENAI_API_KEY          必須。.env(gitignore済み)に置く
 *   KATAZUKU_OPENAI_MODEL   必須(アカウントで使えるモデル名。既定値は持たない)
 *   OPENAI_BASE_URL         既定 https://api.openai.com/v1
 */
import type { AgentAdapter, ProcessResult } from '../agent-runtime.js'
import { toProcessResult } from './http.js'
import { callResponses, OPENAI_API_BASE } from './openai-responses.js'

export interface OpenAiApiOptions {
  env?: NodeJS.ProcessEnv
  fetch?: typeof fetch
}

export function createOpenAiApiAdapter(options: OpenAiApiOptions = {}): AgentAdapter {
  const env = options.env ?? process.env
  const baseUrl = env.OPENAI_BASE_URL?.trim() || OPENAI_API_BASE
  return {
    id: 'openai-api',
    capabilities: new Set<string>(),
    strictCapabilities: true,
    async preflight(request) {
      const missing = request.capabilities.find((capability) => capability)
      if (missing) return { ok: false, failure: 'capability_missing', detail: `openai-api はツールを持たないため ${missing} を使えません` }
      if (!env.OPENAI_API_KEY?.trim()) return { ok: false, failure: 'auth_unavailable', detail: 'OPENAI_API_KEY が未設定です' }
      if (!env.KATAZUKU_OPENAI_MODEL?.trim()) return { ok: false, failure: 'capability_missing', detail: 'KATAZUKU_OPENAI_MODEL が未設定です' }
      return { ok: true }
    },
    buildInvocation(request) {
      return { command: `POST ${baseUrl}/responses`, args: ['model=' + (env.KATAZUKU_OPENAI_MODEL ?? '')], stdin: request.prompt, cwd: request.cwd }
    },
    async run(request, _paths, timeoutMs): Promise<ProcessResult> {
      const started = Date.now()
      return toProcessResult(await callResponses({
        token: env.OPENAI_API_KEY ?? '',
        model: env.KATAZUKU_OPENAI_MODEL ?? '',
        prompt: request.prompt,
        timeoutMs,
        fetch: options.fetch,
        baseUrl,
      }), started)
    },
    async readOutput(result) {
      return result.stdout
    },
    detectPossibleSideEffect() {
      return false
    },
  }
}
