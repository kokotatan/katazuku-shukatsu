/**
 * OpenAI Responses API(POST /v1/responses)をストリームで呼ぶ共通部品。
 * API キー(openai-api)と、Sign in with ChatGPT のアクセストークン(chatgpt-siwc)の両方で使う。
 *
 * ChatGPT プラン利用の要件(https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations):
 * - store: false / stream: true を必ず付ける。input は配列。system ロールの item は使わず instructions を使う。
 * - background / max_output_tokens / metadata / temperature / top_p / previous_response_id などは送らない。
 * - 成功は response.completed を受け取ったときだけ。response.failed / response.incomplete / 途中切断は失敗。
 */
import type { FailureCode } from '../agent-runtime.js'
import { failureForStatus, isAbortError, readSse, type HttpOutcome } from './http.js'

export const OPENAI_API_BASE = 'https://api.openai.com/v1'

export interface ResponsesCall {
  token: string
  model: string
  prompt: string
  instructions?: string
  timeoutMs: number
  fetch?: typeof fetch
  baseUrl?: string
}

/** 送信する本文。ChatGPT プランで拒否される項目はここで絶対に足さない */
export function buildResponsesBody(call: Pick<ResponsesCall, 'model' | 'prompt' | 'instructions'>): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: call.model,
    input: [{ role: 'user', content: call.prompt }],
    store: false,
    stream: true,
  }
  if (call.instructions) body.instructions = call.instructions
  return body
}

/**
 * ChatGPT プラン利用の構造化エラーを、フォールバック判定の分類へ写す。
 * https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery
 */
export function failureForResponsesError(code: string | undefined, status: number): { failure: FailureCode; hint: string } {
  switch (code) {
    case 'subscription_sharing_usage_limit_exceeded':
      return { failure: 'quota_exhausted', hint: 'ChatGPT プラン(またはこのアプリ)の使用量上限に達しました。ChatGPT の設定 → 使用量(Usage)で確認してください' }
    case 'subscription_sharing_usage_unavailable':
    case 'subscription_sharing_user_unavailable':
      return { failure: 'connection_failed', hint: '一時的に使用量を確認できません。時間をおいて再試行します' }
    case 'subscription_sharing_user_not_eligible':
      return { failure: 'capability_missing', hint: 'このユーザー・ワークスペースでは ChatGPT プランを使えません(同じ要求を繰り返さない)' }
    case 'subscription_sharing_unsupported_capability':
      return { failure: 'invalid_output', hint: '要求に ChatGPT プランで使えない項目があります(error.param を確認)' }
    case 'subscription_sharing_route_not_supported':
      return { failure: 'runtime_error', hint: 'このエンドポイントは ChatGPT プランでは使えません' }
    case 'subscription_sharing_invalid_user':
      return { failure: 'auth_unavailable', hint: '利用者の文脈を検証できません。サインインし直してください' }
    case 'chatpass_v2_scope_not_authorized':
    case 'chatpass_v2_invalid_authorization_context':
      return { failure: 'auth_unavailable', hint: '許可(スコープ)がこの操作を認めていません。ChatGPT プラン利用の許可を確認してください' }
    case 'insufficient_quota':
      return { failure: 'quota_exhausted', hint: 'API の残高・上限に達しました' }
    default:
      return { failure: failureForStatus(status), hint: '' }
  }
}

interface ResponsesEvent {
  type?: string
  delta?: string
  response?: { error?: { code?: string; message?: string } | null; incomplete_details?: { reason?: string } | null }
  error?: { code?: string; message?: string }
  code?: string
}

export async function callResponses(call: ResponsesCall): Promise<HttpOutcome> {
  const request = call.fetch ?? fetch
  const base = (call.baseUrl ?? OPENAI_API_BASE).replace(/\/+$/, '')
  let response: Response
  try {
    response = await request(`${base}/responses`, {
      method: 'POST',
      headers: { authorization: `Bearer ${call.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(buildResponsesBody(call)),
      signal: AbortSignal.timeout(call.timeoutMs),
    })
  } catch (error) {
    return { text: '', failure: isAbortError(error) ? 'timeout' : 'connection_failed', diagnostic: 'Responses API へ接続できません' }
  }
  const requestId = response.headers.get('x-request-id') ?? ''
  if (!response.ok || !response.body) {
    // ストリームが始まる前の拒否は標準のエラー形とは限らない({"detail":"..."} など)。文言は診断としてだけ残す
    const raw = await response.text().catch(() => '')
    let code: string | undefined
    try { code = (JSON.parse(raw) as { error?: { code?: string } }).error?.code } catch { /* 非JSON */ }
    const mapped = failureForResponsesError(code, response.status)
    return {
      text: '',
      failure: mapped.failure,
      diagnostic: `Responses API HTTP ${response.status}${code ? ` code=${code}` : ''}${requestId ? ` request_id=${requestId}` : ''} ${mapped.hint} ${raw.slice(0, 300)}`.trim(),
    }
  }
  let text = ''
  let completed = false
  try {
    for await (const event of readSse(response.body)) {
      if (!event.data || event.data === '[DONE]') continue
      let parsed: ResponsesEvent
      try { parsed = JSON.parse(event.data) as ResponsesEvent } catch { continue }
      if (parsed.type === 'response.output_text.delta') text += parsed.delta ?? ''
      else if (parsed.type === 'response.completed') completed = true
      else if (parsed.type === 'response.failed' || parsed.type === 'error') {
        const code = parsed.response?.error?.code ?? parsed.error?.code ?? parsed.code
        const mapped = failureForResponsesError(code, 500)
        return { text: '', failure: mapped.failure, diagnostic: `Responses API 失敗 code=${code ?? 'unknown'}${requestId ? ` request_id=${requestId}` : ''} ${mapped.hint}`.trim() }
      } else if (parsed.type === 'response.incomplete') {
        return { text: '', failure: 'invalid_output', diagnostic: `Responses API 不完全な応答: ${parsed.response?.incomplete_details?.reason ?? 'unknown'}` }
      }
    }
  } catch (error) {
    return { text: '', failure: isAbortError(error) ? 'timeout' : 'connection_failed', diagnostic: 'Responses API のストリームが途中で切れました' }
  }
  if (!completed) return { text: '', failure: 'connection_failed', diagnostic: 'response.completed を受け取る前にストリームが終わりました' }
  return { text }
}
