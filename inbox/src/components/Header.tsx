interface Props {
  doneToday: number
  doneTotal: number
  total: number
  onOpenSettings: () => void
}

export function Header({ doneToday, doneTotal, total, onOpenSettings }: Props) {
  const rate = total === 0 ? 0 : Math.round((doneTotal / total) * 100)
  return (
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
        <h1 className="flex items-baseline gap-2.5 tracking-tight">
          <span className="text-[15px] font-semibold tracking-widest text-slate-400 uppercase">
            katazuku
          </span>
          <span className="text-lg font-bold text-slate-900">Inbox</span>
          <span className="hidden text-xs font-normal text-slate-400 sm:inline">
            就活メール、ぜんぶ片付く。
          </span>
        </h1>

        <div className="ml-auto flex items-center gap-4">
          <div className="hidden items-center gap-2 sm:flex" title="片付け率">
            <div className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-slate-900 transition-all duration-500"
                style={{ width: `${rate}%` }}
              />
            </div>
            <span className="text-xs font-medium text-slate-500">{rate}%</span>
          </div>
          <span className="text-xs text-slate-500">
            今日 <span className="text-base font-bold text-slate-900">{doneToday}</span> 件片付けた
          </span>
          <button
            onClick={onOpenSettings}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          >
            設定・連携
          </button>
        </div>
      </div>
    </header>
  )
}
