/**
 * Web Push購読の保管(Private Blob push-subscriptions.json)の読み出し共通部。
 * 読み方はapi/data.tsと同じ流儀: get() → head()+fetch の順に試す。
 * 先頭が_のファイルはVercelのFunctionにならない(エンドポイント化しない)。
 */

export interface PushSubscriptionRecord {
  endpoint: string
  expirationTime?: number | null
  keys: { p256dh: string; auth: string }
  savedAt?: string
}

const PATHNAME = 'push-subscriptions.json'

export async function loadSubscriptions(): Promise<PushSubscriptionRecord[]> {
  const blobMod = (await import('@vercel/blob')) as unknown as Record<string, unknown>
  let text: string | null = null

  if (typeof blobMod.get === 'function') {
    try {
      const r = (await (blobMod.get as (p: string, o?: unknown) => Promise<{ stream?: ReadableStream | null } | null>)(
        PATHNAME, { access: 'private' },
      ))
      if (r?.stream) text = await new Response(r.stream).text()
    } catch { /* 次の読み方へ */ }
  }
  if (text === null && typeof blobMod.head === 'function') {
    try {
      const h = await (blobMod.head as (p: string) => Promise<{ url?: string; downloadUrl?: string } | null>)(PATHNAME)
      const u = h?.downloadUrl ?? h?.url
      if (u) {
        const r = await fetch(u)
        if (r.ok) text = await r.text()
      }
    } catch { /* 未作成なら空扱い */ }
  }
  if (text === null) return []
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? (parsed as PushSubscriptionRecord[]) : []
  } catch {
    return []
  }
}
