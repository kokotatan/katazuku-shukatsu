export type Kind = 'gakuchika' | 'research' | 'jikoPR' | 'shibou' | 'other'

/** ESの部品(スニペット) */
export interface Snippet {
  id: string
  kind: Kind
  /** 「LayerXハッカソンの話」など */
  title: string
  body: string
  /** 目標文字数(null=指定なし) */
  targetChars: number | null
  /** 使った企業名のメモ */
  usedAt: string[]
  updatedAt: string
}

export const KINDS: { key: Kind; label: string }[] = [
  { key: 'gakuchika', label: 'ガクチカ' },
  { key: 'research', label: '研究概要' },
  { key: 'jikoPR', label: '自己PR' },
  { key: 'shibou', label: '志望動機' },
  { key: 'other', label: 'その他' },
]
