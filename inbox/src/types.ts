import type { SelectionKind } from './lib/selection'

export type Category = 'interview' | 'result' | 'task' | 'test' | 'event' | 'other'

export type Status = 'inbox' | 'done' | 'snoozed'

/** 受信メール1通。分類・締切抽出済みの状態で保持する */
export interface Email {
  id: string
  from: string
  fromAddress: string
  company: string
  subject: string
  body: string
  receivedAt: string
  category: Category
  /** 進行中の選考か、募集案内か、サービスの宣伝か */
  selectionKind: SelectionKind
  /** 抽出された締切・予定日時 (ISO)。なければ null */
  deadline: string | null
  /** deadline が「〆切」なのか「開催日時」なのか */
  deadlineKind: 'deadline' | 'event' | null
  /** 返信・回答・提出などのアクションが必要か */
  needsAction: boolean
  /** 「6/15(月) 17:00 までに回答」のような一言ヒント */
  actionHint: string | null
  /** 「日程を選んで回答」「ESを提出」のような具体的なやること */
  actionSteps: string[]
  /** アクションを実行するフォーム・マイページ等のURL */
  actionUrl: string | null
  status: Status
  snoozeUntil: string | null
  doneAt: string | null
  source: 'demo' | 'gmail' | 'import'
}

/** 分類前の生メール (Gmail取得・インポート・デモ共通の入力形) */
export interface RawEmail {
  id: string
  from: string
  fromAddress: string
  subject: string
  body: string
  receivedAt: string
  source: Email['source']
}

export const CATEGORY_META: Record<Category, { label: string }> = {
  interview: { label: '面接・日程調整' },
  result: { label: '選考結果' },
  task: { label: 'ES・提出タスク' },
  test: { label: '適性検査' },
  event: { label: '説明会・イベント' },
  other: { label: 'その他' },
}
