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
