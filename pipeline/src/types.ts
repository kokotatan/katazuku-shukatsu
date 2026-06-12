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

export const STAGES: { key: Stage; label: string; icon: string; accent: string }[] = [
  { key: 'scouted', label: '気になる', icon: '👀', accent: 'border-slate-300' },
  { key: 'entried', label: 'エントリー済み', icon: '📮', accent: 'border-sky-400' },
  { key: 'task', label: 'ES・テスト', icon: '✍️', accent: 'border-amber-400' },
  { key: 'interview', label: '面接・面談', icon: '🗣️', accent: 'border-violet-400' },
  { key: 'intern', label: 'インターン合格', icon: '🎫', accent: 'border-teal-400' },
  { key: 'offer', label: '内定', icon: '🎉', accent: 'border-emerald-400' },
  { key: 'closed', label: '終了', icon: '🍃', accent: 'border-slate-200' },
]
