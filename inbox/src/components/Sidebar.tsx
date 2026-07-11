import { Button, StatusLabel } from 'smarthr-ui'
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
  label,
  count,
  highlight,
  onClick,
}: {
  active: boolean
  label: string
  count: number
  highlight?: boolean
  onClick: () => void
}) {
  // フィルタは smarthr-ui の Button に載せ替える。選択中は primary、未選択は text。
  // 件数バッジは StatusLabel(要対応など緊急のものは red)で表す。
  return (
    <Button
      wide
      size="S"
      variant={active ? 'primary' : 'text'}
      onClick={onClick}
      suffix={
        count > 0 ? (
          <StatusLabel type={highlight ? 'red' : 'grey'} bold={highlight}>
            {count}
          </StatusLabel>
        ) : undefined
      }
    >
      {label}
    </Button>
  )
}

export function Sidebar({ filter, counts, onSelect }: Props) {
  return (
    <nav className="flex w-52 shrink-0 flex-col gap-1">
      <Item
        active={filter === 'action'}
        label="要対応"
        count={counts.action}
        highlight
        onClick={() => onSelect('action')}
      />
      <Item
        active={filter === 'selection'}
        label="選考のみ"
        count={counts.selection}
        onClick={() => onSelect('selection')}
      />
      <Item
        active={filter === 'all'}
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
          label={CATEGORY_META[c].label}
          count={counts[c]}
          onClick={() => onSelect(c)}
        />
      ))}

      <div className="mt-3 border-t border-slate-200 pt-3">
        <Item
          active={filter === 'snoozed'}
          label="スヌーズ中"
          count={counts.snoozed}
          onClick={() => onSelect('snoozed')}
        />
        <Item
          active={filter === 'done'}
          label="片付け済み"
          count={counts.done}
          onClick={() => onSelect('done')}
        />
      </div>

      <div className="mt-6 rounded-lg bg-slate-200/60 p-3 text-[11px] leading-relaxed text-slate-500">
        <p className="mb-1 font-semibold text-slate-600">キーボード操作</p>
        <p>J / K : 上下移動</p>
        <p>Enter : 本文を開く</p>
        <p>E : 片付けた</p>
        <p>S : 明日の朝へ</p>
      </div>
    </nav>
  )
}
