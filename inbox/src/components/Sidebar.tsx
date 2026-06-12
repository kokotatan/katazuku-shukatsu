import { CATEGORY_META, type Category } from '../types'

export type Filter = 'action' | 'selection' | 'all' | Category | 'snoozed' | 'done'

interface Props {
  filter: Filter
  counts: Record<Filter, number>
  onSelect: (f: Filter) => void
}

const CATEGORIES = Object.keys(CATEGORY_META) as Category[]

function Item({
  active,
  icon,
  label,
  count,
  highlight,
  onClick,
}: {
  active: boolean
  icon: string
  label: string
  count: number
  highlight?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${
        active ? 'bg-slate-800 font-semibold text-white' : 'text-slate-600 hover:bg-slate-200'
      }`}
    >
      <span aria-hidden>{icon}</span>
      <span className="flex-1">{label}</span>
      {count > 0 && (
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-bold ${
            highlight && !active
              ? 'bg-rose-500 text-white'
              : active
                ? 'bg-white/20 text-white'
                : 'bg-slate-300 text-slate-600'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  )
}

export function Sidebar({ filter, counts, onSelect }: Props) {
  return (
    <nav className="flex w-52 shrink-0 flex-col gap-1">
      <Item
        active={filter === 'action'}
        icon="🔥"
        label="要対応"
        count={counts.action}
        highlight
        onClick={() => onSelect('action')}
      />
      <Item
        active={filter === 'selection'}
        icon="🎯"
        label="選考のみ"
        count={counts.selection}
        onClick={() => onSelect('selection')}
      />
      <Item
        active={filter === 'all'}
        icon="📥"
        label="受信トレイ"
        count={counts.all}
        onClick={() => onSelect('all')}
      />

      <div className="mt-3 mb-1 px-3 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
        カテゴリ
      </div>
      {CATEGORIES.map((c) => (
        <Item
          key={c}
          active={filter === c}
          icon={CATEGORY_META[c].icon}
          label={CATEGORY_META[c].label}
          count={counts[c]}
          onClick={() => onSelect(c)}
        />
      ))}

      <div className="mt-3 border-t border-slate-200 pt-3">
        <Item
          active={filter === 'snoozed'}
          icon="😴"
          label="スヌーズ中"
          count={counts.snoozed}
          onClick={() => onSelect('snoozed')}
        />
        <Item
          active={filter === 'done'}
          icon="✅"
          label="片付け済み"
          count={counts.done}
          onClick={() => onSelect('done')}
        />
      </div>

      <div className="mt-6 rounded-lg bg-slate-200/60 p-3 text-[11px] leading-relaxed text-slate-500">
        <p className="mb-1 font-semibold text-slate-600">⌨️ ショートカット</p>
        <p>J / K : 上下移動</p>
        <p>Enter : 本文を開く</p>
        <p>E : 片付けた</p>
        <p>S : 明日の朝へ</p>
      </div>
    </nav>
  )
}
