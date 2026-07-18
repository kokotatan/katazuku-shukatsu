/**
 * ES向けの文字数カウント。
 * ルール: 改行は数えない。空白(全角・半角)は数える(多くのESフォームと同じ)。
 * 全角換算は半角英数記号・半角カナを0.5文字として切り上げ。
 */
export interface CharCount {
  /** 改行を除いた文字数(コードポイント単位) */
  chars: number
  /** 全角換算(半角=0.5、切り上げ) */
  zenkaku: number
}

const HALF_RE = /[\x20-\x7E｡-ﾟ]/

export function countChars(text: string): CharCount {
  const body = text.replace(/\r?\n/g, '')
  let chars = 0
  let half = 0
  for (const ch of body) {
    chars++
    if (HALF_RE.test(ch)) half++
  }
  return { chars, zenkaku: Math.ceil(chars - half / 2) }
}

/** 目標文字数との差分表示。「あと52字」「12字オーバー」「ぴったり」 */
export function targetLabel(chars: number, target: number | null): { text: string; over: boolean } | null {
  if (target === null || target <= 0) return null
  const diff = target - chars
  if (diff > 0) return { text: `あと${diff}字`, over: false }
  if (diff < 0) return { text: `${-diff}字オーバー`, over: true }
  return { text: 'ぴったり', over: false }
}
