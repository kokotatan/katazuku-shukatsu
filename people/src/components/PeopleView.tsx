import { useMemo, useState } from 'react'
import { Input, StatusLabel } from 'smarthr-ui'
import type { Person } from '../types'
import { sameCompany } from '../lib/names'
import { CATEGORIES, personCategory } from '../lib/people'

/** 顔サムネイル。無ければ頭文字フォールバック */
export function Face({ person, size = 44 }: { person: Person; size?: number }) {
  const style = { width: size, height: size }
  if (person.facePhoto) {
    return (
      <img
        src={person.facePhoto}
        alt=""
        style={style}
        className="shrink-0 rounded-full border border-slate-200 object-cover"
      />
    )
  }
  return (
    <span
      aria-hidden
      style={style}
      className="flex shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-sm font-bold text-slate-500"
    >
      {person.name.trim().charAt(0) || '?'}
    </span>
  )
}

/** 種別バッジ(装飾色は使わず、中立のスレートチップで区別) */
function CategoryBadge({ category }: { category: string }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded border border-slate-300 bg-slate-50 px-1.5 py-px text-[11px] font-medium text-slate-600">
      {category}
    </span>
  )
}

/** 名簿の1件。クリックで編集モーダルを開く */
function PersonCard({ person, onSelect }: { person: Person; onSelect: () => void }) {
  const category = personCategory(person)
  const sub = [person.company, person.role].filter(Boolean).join(' / ')
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-start gap-3 rounded-lg border border-slate-300 bg-white p-3 text-left transition hover:border-blue-400 hover:bg-blue-50/30"
    >
      <Face person={person} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold text-slate-800">{person.name}</span>
          <CategoryBadge category={category} />
          {person.followUp && <StatusLabel type="warning">要フォロー</StatusLabel>}
        </div>
        {sub && <p className="mt-0.5 truncate text-xs text-slate-500">{sub}</p>}
        {person.metAt && <p className="mt-0.5 truncate text-xs text-slate-400">{person.metAt}</p>}
      </div>
    </button>
  )
}

export function PeopleView({
  people,
  onSelectPerson,
}: {
  people: Person[]
  /** 人をクリックしたとき(編集モーダルを開く) */
  onSelectPerson: (person: Person) => void
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<string>('全員')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return people.filter((p) => {
      if (filter !== '全員' && personCategory(p) !== filter) return false
      if (!q) return true
      return [p.name, p.company, p.role, p.metAt, p.howMet, p.notes]
        .filter(Boolean)
        .some((s) => s.toLowerCase().includes(q))
    })
  }, [people, query, filter])

  // 企業ごとにグルーピング(名寄せ)。会社未設定は末尾の「所属未設定」へ
  const groups = useMemo(() => {
    const gs: { company: string; members: Person[] }[] = []
    for (const p of filtered) {
      const key = p.company || ''
      const hit = gs.find((g) => (key ? sameCompany(g.company, key) : g.company === ''))
      if (hit) hit.members.push(p)
      else gs.push({ company: key, members: [p] })
    }
    return gs
  }, [filtered])

  const filters = ['全員', ...CATEGORIES]

  return (
    <main className="mx-auto max-w-5xl px-6 py-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          type="search"
          width="100%"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="名前・会社・肩書き・メモで検索"
          className="sm:max-w-xs"
        />
        <div className="flex flex-wrap gap-1.5">
          {filters.map((f) => {
            const active = filter === f
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={
                  'rounded-full border px-3 py-1 text-xs font-medium transition ' +
                  (active
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400')
                }
              >
                {f}
              </button>
            )
          })}
        </div>
      </div>

      {people.length === 0 ? (
        <p className="py-16 text-center text-sm text-slate-400">
          まだ登録がありません。右上の「登録」から、面接や説明会で会った人を追加しましょう
        </p>
      ) : filtered.length === 0 ? (
        <p className="py-16 text-center text-sm text-slate-400">
          条件に合う人がいません。検索語や種別フィルタを変えてみてください
        </p>
      ) : (
        groups.map((g) => (
          <section key={g.company || '__none__'} className="mb-7">
            <h2 className="mb-2.5 flex items-baseline gap-2 border-b border-slate-200 pb-1.5">
              <span className="text-base font-semibold text-slate-800">
                {g.company || '所属未設定'}
              </span>
              <span className="text-xs font-normal text-slate-400">{g.members.length}人</span>
            </h2>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {g.members.map((p) => (
                <PersonCard key={p.id} person={p} onSelect={() => onSelectPerson(p)} />
              ))}
            </div>
          </section>
        ))
      )}
    </main>
  )
}
