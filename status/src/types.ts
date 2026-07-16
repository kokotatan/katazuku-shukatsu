export type Stage = 'scouted' | 'entried' | 'task' | 'interview' | 'intern' | 'offer' | 'closed'

/** 1社分の選考状況 */
export interface Company {
  id: string
  name: string
  /** 職種・コース名 */
  role: string
  stage: Stage
  /** 次にやること(「ESを提出」「日程を回答」など) */
  nextAction: string
  /** 次のアクションの期限・予定日 (YYYY-MM-DD) */
  nextDate: string | null
  memo: string
  /** 業界(選考管理シート由来) */
  industry?: string
  /** 志望度(第１志望群 など) */
  priority?: string
  /** マイページURL */
  mypageUrl?: string
  /** 企業ロゴ(dataURL または http URL) */
  logo?: string
  updatedAt: string
}

export const STAGES: { key: Stage; label: string }[] = [
  { key: 'scouted', label: '気になる' },
  { key: 'entried', label: 'エントリー済み' },
  { key: 'task', label: 'ES・テスト' },
  { key: 'interview', label: '面接・面談' },
  { key: 'intern', label: 'インターン合格' },
  { key: 'offer', label: '内定' },
  { key: 'closed', label: '終了' },
]
