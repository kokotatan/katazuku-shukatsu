/** Googleの読取りAPIだけを、時間制限と一時障害の再試行付きで呼ぶ。 */
// Gmailの403 rateLimitExceededは「ユーザーごと・1分あたり」の枠で返る(2026-09-30実測)。
// 待ち時間の合計が1分を超えるまで再試行しないと枠が戻る前に諦めてしまうため、
// 1+2+4+8+16+32=63秒待てる7回にする。
const MAX_ATTEMPTS = 7

export async function googleRead(url: string, token: string, options: {
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
} = {}): Promise<Response> {
  const request = options.fetch ?? fetch
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let response: Response
    try {
      response = await request(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) })
    } catch (error) {
      if (attempt === MAX_ATTEMPTS - 1) throw error
      await sleep(1000 * 2 ** attempt)
      continue
    }
    let retryable = response.status === 429 || response.status >= 500
    if (response.status === 403) {
      // 権限不足・ドメインポリシー・日次上限は再試行で回避しない。
      const body = await response.clone().json().catch(() => null) as { error?: { errors?: { reason?: string }[] } } | null
      retryable = body?.error?.errors?.some(item => ['rateLimitExceeded', 'userRateLimitExceeded'].includes(item.reason ?? '')) ?? false
    }
    if (!retryable || attempt === MAX_ATTEMPTS - 1) return response
    const retryAfter = Number(response.headers.get('retry-after'))
    await response.body?.cancel()
    await sleep(Math.max(1000 * 2 ** attempt, Number.isFinite(retryAfter) ? Math.min(60, retryAfter) * 1000 : 0))
  }
  throw new Error('Google読取の再試行上限に達しました')
}
