/** Inbox(katazuku-inbox/emails)から読む最小限の形 */
export interface InboxEmail {
  id: string
  company: string
  subject: string
  deadline: string | null
  needsAction: boolean
  status: 'inbox' | 'done' | 'snoozed'
  snoozeUntil?: string | null
  actionSteps?: string[]
  actionHint?: string | null
}

/** Pipeline(katazuku-pipeline/companies)から読む最小限の形 */
export interface PipelineCompany {
  id: string
  name: string
  stage: string
  nextAction: string
  nextDate: string | null
}

/** 集約後の1行 */
export interface TodayItem {
  key: string
  source: 'inbox' | 'pipeline'
  company: string
  title: string
  /** ISO。pipelineの日付はその日の23:59扱い */
  due: string
  hasTime: boolean
}

export interface Buckets {
  overdue: TodayItem[]
  today: TodayItem[]
  week: TodayItem[]
  /** 7日より先の件数(表示は件数のみ) */
  laterCount: number
  /** 期限なしの要対応メール件数 */
  datelessCount: number
}
