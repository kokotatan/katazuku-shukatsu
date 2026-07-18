/** Inbox(katazuku-inbox/emails)から読む最小限の形 */
export interface InboxEmail {
  id: string
  company: string
  subject: string
  /** 受信日時 (ISO)。月別集計に使う */
  receivedAt?: string
  deadline: string | null
  /** deadline が「〆切」か「開催日時」か */
  deadlineKind?: 'deadline' | 'event' | null
  needsAction: boolean
  status: 'inbox' | 'done' | 'snoozed'
  snoozeUntil?: string | null
  /** 片付けた日時 (ISO)。なければ null */
  doneAt?: string | null
  actionSteps?: string[]
  actionHint?: string | null
  /** 選考/募集案内/課外/宣伝/対象外(古いデータには無いことがある) */
  selectionKind?: string
}

/** Pipeline(katazuku-pipeline/companies)から読む最小限の形 */
export interface PipelineCompany {
  id: string
  name: string
  stage: string
  nextAction: string
  nextDate: string | null
}
