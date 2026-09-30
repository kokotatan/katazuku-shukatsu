/**
 * HTTP型 provider(API キー / ChatGPT プラン)の共通部品。依存ゼロ(標準の fetch と ReadableStream だけ)。
 *
 * CLI型 provider と同じ実行契約(ProcessResult)へ結果を写すことで、runAgent の
 * フォールバック判定・利用枠の健康状態・成果物の保存をそのまま使えるようにする。
 */
import type { FailureCode, ProcessResult } from '../agent-runtime.js'

export interface SseEvent {
  event?: string
  data: string
}

/** Server-Sent Events を1イベントずつ取り出す(data: の複数行連結・コメント行・CRLF に対応) */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder()
  let buffer = ''
  let event: string | undefined
  let data: string[] = []
  const reader = body.getReader()
  const flush = function* (): Generator<SseEvent> {
    if (data.length) yield { event, data: data.join('\n') }
    event = undefined
    data = []
  }
  while (true) {
    const { value, done } = await reader.read()
    buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
    let newline: number
    while ((newline = buffer.search(/\r?\n/)) >= 0) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + (buffer[newline] === '\r' ? 2 : 1))
      if (line === '') { yield* flush(); continue }
      if (line.startsWith(':')) continue
      const colon = line.indexOf(':')
      const field = colon >= 0 ? line.slice(0, colon) : line
      const fieldValue = colon >= 0 ? line.slice(colon + 1).replace(/^ /, '') : ''
      if (field === 'event') event = fieldValue
      else if (field === 'data') data.push(fieldValue)
    }
    if (done) {
      if (buffer) {
        const line = buffer
        buffer = ''
        if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
      }
      yield* flush()
      return
    }
  }
}

export interface HttpOutcome {
  text: string
  failure?: FailureCode
  /** 利用者へそのまま見せてよい診断(秘密値を含めない) */
  diagnostic?: string
}

/**
 * HTTPの結果を ProcessResult へ写す。stdout はモデルの最終出力、stderr は診断。
 * ツール実行が起きないので、副作用の可能性は常に無し(detectPossibleSideEffect=false)として扱える。
 */
export function toProcessResult(outcome: HttpOutcome, startedAt: number): ProcessResult {
  return {
    exitCode: outcome.failure ? 1 : 0,
    signal: null,
    stdout: outcome.failure ? '' : outcome.text,
    stderr: outcome.diagnostic ?? '',
    timedOut: outcome.failure === 'timeout',
    durationMs: Date.now() - startedAt,
    // 応答本文の文言から推測させず、HTTP層で確定した分類をそのまま渡す(誤分類で締め出さないため)
    failureHint: outcome.failure,
  }
}

/** HTTP ステータスから、安全に次の provider へ回せる失敗の種類を決める(本文は読まずに済む範囲だけ) */
export function failureForStatus(status: number): FailureCode {
  if (status === 401) return 'auth_unavailable'
  if (status === 403) return 'auth_unavailable'
  if (status === 429) return 'rate_limited'
  if (status === 408 || status === 504) return 'timeout'
  if (status >= 500) return 'connection_failed'
  return 'runtime_error'
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
}
