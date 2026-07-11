import { Button } from 'smarthr-ui'

interface Props {
  doneToday: number
  doneTotal: number
  total: number
  onOpenSettings: () => void
}

export function Header({ doneToday, doneTotal, total, onOpenSettings }: Props) {
  const rate = total === 0 ? 0 : Math.round((doneTotal / total) * 100)
  return (
    <header className="sticky top-0 z-10 border-b border-slate-300 bg-white">
      <div className="flex items-center gap-4 px-6 py-3">
        <h1 className="flex items-baseline gap-2.5">
          <span className="text-lg font-bold tracking-tight text-slate-900">メール</span>
          <span className="hidden text-xs font-normal text-slate-500 sm:inline">
            就活メール、ぜんぶ片付く。
          </span>
        </h1>

        <div className="ml-auto flex items-center gap-4">
          <div className="hidden items-center gap-2 sm:flex" title="片付け率">
            <div className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-blue-500 transition-all duration-500"
                style={{ width: `${rate}%` }}
              />
            </div>
            <span className="text-xs font-medium text-slate-500">{rate}%</span>
          </div>
          <span className="text-xs text-slate-500">
            今日 <span className="text-base font-bold text-slate-900">{doneToday}</span> 件片付けた
          </span>
          <Button size="S" variant="secondary" onClick={onOpenSettings}>
            設定・連携
          </Button>
        </div>
      </div>
    </header>
  )
}
