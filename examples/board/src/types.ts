/** examples/board-snapshot.ts が書き出す JSON の形。DBへは触らず、この1枚だけを読む */
export interface BoardSnapshot {
  generatedAt: string
  demo: boolean
  selections: SelectionCard[]
  appointments: AppointmentCard[]
  pending: PendingCard[]
  mail: MailCard[]
}

export interface SelectionCard {
  id: number
  company: string
  season: string
  position: string
  priority: string
  status: string
  /** 進行中 / 合格 / 不合格 / 辞退 / 内定 — outcomeOf() の機械判定 */
  outcome: string
  nextAction: string
  nextDate: string
  submitted: boolean
  steps: string[]
}

export interface AppointmentCard {
  id: number
  company: string
  at: string
  endAt: string
  kind: string
  title: string
  hasUrl: boolean
  location: string
  status: string
}

export interface PendingCard {
  name: string
  context: string
  createdAt: string
}

export interface MailCard {
  id: string
  company: string | null
  subject: string
  summary: string
  category: string
  deadline: string
  receivedAt: string
}
