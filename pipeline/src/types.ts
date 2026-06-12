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
  updatedAt: string
}

export const STAGES: { key: Stage; label: string; accent: string }[] = [
  { key: 'scouted', label: '気になる', accent: 'border-slate-300' },
  { key: 'entried', label: 'エントリー済み', accent: 'border-slate-400' },
  { key: 'task', label: 'ES・テスト', accent: 'border-slate-500' },
  { key: 'interview', label: '面接・面談', accent: 'border-slate-700' },
  { key: 'intern', label: 'インターン合格', accent: 'border-slate-900' },
  { key: 'offer', label: '内定', accent: 'border-slate-900' },
  { key: 'closed', label: '終了', accent: 'border-slate-200' },
]
