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
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
        <h1 className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="flex h-7 w-7 items-center justify-center rounded-[4px] bg-slate-900 pt-0.5 font-display text-[15px] font-semibold leading-none text-white"
          >
            片
          </span>
          <span className="flex items-baseline gap-2">
            <span className="font-display text-lg font-semibold tracking-tight text-slate-900">
              katazuku
            </span>
            <span className="text-[11px] font-semibold tracking-[0.25em] text-slate-400 uppercase">
              Inbox
            </span>
          </span>
          <span className="hidden border-l border-slate-200 pl-2.5 text-xs font-normal text-slate-400 sm:inline">
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
            今日 <span className="font-display text-base font-semibold text-slate-900">{doneToday}</span> 件片付けた
          </span>
          <Button size="S" variant="secondary" onClick={onOpenSettings}>
            設定・連携
          </Button>
        </div>
      </div>
    </header>
  )
}
