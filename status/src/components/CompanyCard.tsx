import { StatusLabel } from 'smarthr-ui'
import type { Company } from '../types'

interface Props {
  company: Company
  onClick: () => void
  onDragStart: (e: React.DragEvent) => void
}

const WEEKDAYS = '日月火水木金土'

type LabelType = 'grey' | 'blue' | 'red' | 'warning' | 'error'

// 期限までの残り日数で StatusLabel の種類とラベル文言を決める
function dateBadge(nextDate: string | null): { text: string; type: LabelType } | null {
  if (!nextDate) return null
  const d = new Date(`${nextDate}T23:59:59`)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = Math.round((d.getTime() - today.getTime() - 86399e3) / 86400e3)
  const label = `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`
  if (days < 0) return { text: `${label} 期限切れ`, type: 'error' }
  if (days === 0) return { text: `${label} 今日`, type: 'warning' }
  if (days <= 3) return { text: `${label} あと${days}日`, type: 'red' }
  return { text: `${label} あと${days}日`, type: 'grey' }
}

// ロゴ画像。無ければ企業名の頭文字を slate 背景の角丸 boxで代替する
function CompanyLogo({ name, logo }: { name: string; logo?: string }) {
  if (logo) {
    return (
      <img
        src={logo}
        alt=""
        className="h-8 w-8 shrink-0 rounded-md border border-slate-200 object-cover"
      />
    )
  }
  return (
    <span
      aria-hidden
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-100 text-sm font-bold text-slate-500"
    >
      {name.trim().charAt(0) || '?'}
    </span>
  )
}

export function CompanyCard({ company, onClick, onDragStart }: Props) {
  const badge = dateBadge(company.nextDate)
  const isTopChoice =
    !!company.priority && (company.priority.includes('１') || company.priority.includes('1'))
  return (
    <button
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className="w-full cursor-grab rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-slate-300 hover:shadow active:cursor-grabbing"
    >
      <div className="flex items-start gap-2">
        <CompanyLogo name={company.name} logo={company.logo} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-slate-800">{company.name}</p>
          {company.role && <p className="mt-0.5 text-xs text-slate-400">{company.role}</p>}
        </div>
      </div>
      {(company.priority || company.industry) && (
        <p className="mt-1 flex flex-wrap gap-1">
          {company.priority && (
            <StatusLabel type={isTopChoice ? 'blue' : 'grey'} bold={isTopChoice}>
              {company.priority}
            </StatusLabel>
          )}
          {company.industry && <StatusLabel type="grey">{company.industry}</StatusLabel>}
        </p>
      )}
      {company.nextAction && (
        <p className="mt-2 text-xs leading-relaxed text-slate-600">{company.nextAction}</p>
      )}
      {badge && (
        <span className="mt-2 inline-block">
          <StatusLabel type={badge.type} bold={badge.type === 'error'}>
            {badge.text}
          </StatusLabel>
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
          className="mt-2 ml-1 inline-block rounded px-1.5 py-0.5 text-xs font-medium text-slate-500 underline decoration-slate-300 underline-offset-2 hover:text-slate-800"
        >
          マイページ ↗
        </span>
      )}
    </button>
  )
}
