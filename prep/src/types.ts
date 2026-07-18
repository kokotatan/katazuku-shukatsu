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

/** 選考で会った人(顔と前回の会話を残す) */
export interface Person {
  id: string
  name: string
  company: string
  role: string // 部署・肩書き
  metAt: string // 出会った場面(例「7/16 二次面接」)
  howMet: string // どこでどう会ったか一言
  notes: string // 話した内容・人柄・刺さった言葉(=前回この人と話したこと)
  facePhoto?: string // 顔写真 dataURL
  followUp: boolean // お礼・連絡が必要か
  updatedAt: string
}
