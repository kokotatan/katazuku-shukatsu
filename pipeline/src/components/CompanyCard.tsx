import type { Company } from '../types'

interface Props {
  company: Company
  onClick: () => void
  onDragStart: (e: React.DragEvent) => void
}

const WEEKDAYS = '日月火水木金土'

function dateBadge(nextDate: string | null): { text: string; cls: string } | null {
  if (!nextDate) return null
  const d = new Date(`${nextDate}T23:59:59`)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = Math.round((d.getTime() - today.getTime() - 86399e3) / 86400e3)
  const label = `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`
  if (days < 0) return { text: `${label} 期限切れ`, cls: 'bg-rose-600 text-white' }
  if (days === 0) return { text: `${label} 今日`, cls: 'bg-rose-100 text-rose-700' }
  if (days <= 3) return { text: `${label} あと${days}日`, cls: 'bg-amber-100 text-amber-700' }
  return { text: `${label} あと${days}日`, cls: 'bg-slate-100 text-slate-500' }
}

export function CompanyCard({ company, onClick, onDragStart }: Props) {
  const badge = dateBadge(company.nextDate)
  return (
    <button
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className="w-full cursor-grab rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-slate-300 hover:shadow active:cursor-grabbing"
    >
      <p className="text-sm font-bold text-slate-800">{company.name}</p>
      {company.role && <p className="mt-0.5 text-xs text-slate-400">{company.role}</p>}
      {(company.priority || company.industry) && (
        <p className="mt-1 flex flex-wrap gap-1">
          {company.priority && (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                company.priority.includes('１') || company.priority.includes('1')
                  ? 'bg-rose-100 text-rose-700'
                  : 'bg-slate-100 text-slate-500'
              }`}
            >
              {company.priority}
            </span>
          )}
          {company.industry && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
              {company.industry}
            </span>
          )}
        </p>
      )}
      {company.nextAction && (
        <p className="mt-2 text-xs leading-relaxed text-slate-600">👉 {company.nextAction}</p>
      )}
      {badge && (
        <span className={`mt-2 inline-block rounded px-1.5 py-0.5 text-xs font-bold ${badge.cls}`}>
          ⏰ {badge.text}
        </span>
      )}
      {company.mypageUrl && (
        <span
          role="link"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation()
            window.open(company.mypageUrl, '_blank', 'noreferrer')
          }}
          className="mt-2 ml-1 inline-block rounded px-1.5 py-0.5 text-xs font-medium text-indigo-600 underline-offset-2 hover:underline"
        >
          🔗 マイページ
        </span>
      )}
    </button>
  )
}
