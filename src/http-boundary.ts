/** 通信先や受信内容の検査。秘密を例外文へ含めない。 */
export function connectionOrigin(value: string): string {
  let url: URL
  try { url = new URL(value) } catch { throw new Error('接続先の形式を確認してください。') }
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password
    || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('接続先は HTTPS のアドレスを指定してください。パスや認証情報は含められません。')
  }
  return url.origin
}
export class BodyError extends Error {
  constructor(readonly status: number) { super('受信したデータの形式またはサイズが不正です。') }
}
/** 上限を超えた時点で読取を停止する。Content-Lengthだけを信用しない。 */
export async function boundedJson(message: Pick<Response, 'headers' | 'body'>, maximum: number): Promise<unknown> {
  if (message.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') throw new BodyError(415)
  const length = message.headers.get('content-length')
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum)) throw new BodyError(413)
  if (!message.body) throw new BodyError(400)
  const reader = message.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maximum) throw new BodyError(413)
      chunks.push(value)
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error }
  finally { reader.releaseLock() }
  // fetchは圧縮を解いた本文を返す場合があるため、Content-Lengthとの一致は要求しない。
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  catch { throw new BodyError(400) }
}
