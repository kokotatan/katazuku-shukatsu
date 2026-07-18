export type PrepKind = 'retro' | 'qa' | 'axis'

/** 振り返り・想定問答・就活の軸の1エントリ */
export interface PrepEntry {
  id: string
  /** 企業名(axisは空でよい=全社共通) */
  company: string
  kind: PrepKind
  /** qa: 想定質問 / retro: 場面 / axis: テーマ */
  question: string
  /** 自分の答え・反省・次にどうするか */
  answer: string
  updatedAt: string
}

export const KIND_META: Record<PrepKind, { label: string }> = {
  retro: { label: '振り返り' },
  qa: { label: '想定問答' },
  axis: { label: '就活の軸' },
}
