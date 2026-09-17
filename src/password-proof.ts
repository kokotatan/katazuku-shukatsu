/** TLS上で送るパスワード相当の値。保存・ログ出力・URLへの追加を禁止する。 */
export async function derivePasswordProof(password: string, challenge: unknown): Promise<string> {
  const value = challenge as { scheme?: string; salt?: string } | null
  if (!value || value.scheme !== 'pbkdf2-sha256-600000-v1' || typeof value.salt !== 'string' || !/^[a-f0-9]{32}$/.test(value.salt)) throw new Error('パスワードの設定を確認できません。PCから設定画面を開き直してください。')
  if (typeof password !== 'string' || !password || password.length > 256) throw new Error('パスワードを入力してください。')
  const encoder = new TextEncoder()
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(value.salt), iterations: 600_000, hash: 'SHA-256' }, material, 256)
  return Array.from(new Uint8Array(bits), byte => byte.toString(16).padStart(2, '0')).join('')
}
