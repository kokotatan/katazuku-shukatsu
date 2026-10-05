/** 保存画面とローカル診断で、雛形の値を実利用の設定と扱わないための共通判定。 */
export function isSuppliedSetting(value: unknown): value is string {
  return typeof value === 'string' && !!value.trim() && !/example|replace[-_ ]?me|your[-_ ]|^<.*>$/i.test(value)
}

export function isPersonalProfile(displayName: string, signature: string[]): boolean {
  return isSuppliedSetting(displayName) && displayName !== '就活 太郎'
    && signature.some(isSuppliedSetting)
    && signature.every(line => !/サンプル大学|就活 太郎|example\.(?:com|net|org)/i.test(line))
}

export function isGoogleAccountEmail(email: string): boolean {
  return /^[^\s@/\\]+@[^\s@/\\]+\.[^\s@/\\]+$/.test(email)
    && !/@(?:[^@]+\.)?example\.(?:com|net|org)$/i.test(email)
}
