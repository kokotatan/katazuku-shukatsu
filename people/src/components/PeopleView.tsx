import { useMemo, useState } from 'react'
import { Input, Select, StatusLabel } from 'smarthr-ui'
import type { Person } from '../types'
import {
  CATEGORIES,
  distinctCompanies,
  distinctMonths,
  metMonth,
  personCategory,
} from '../lib/people'

/**
 * 顔サムネイル。四角(角丸)で object-cover。無ければ頭文字を塗り背景で代替。
 * カオナビ/SmartHR の従業員名簿に合わせ、円形にはしない。
 */
export function Face({ person, size = 44 }: { person: Person; size?: number }) {
  const style = { width: size, height: size }
  if (person.facePhoto) {
    return (
      <img
        src={person.facePhoto}
        alt=""
        style={style}
        className="shrink-0 rounded-lg border border-slate-200 object-cover"
      />
    )
  }
  return (
    <span
      aria-hidden
      style={style}
      className="flex shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 font-bold text-slate-500"
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

/** グリッドの1セル。正方形の顔サムネ+名前+会社+種別。クリックで詳細を開く */
function PersonCell({ person, onSelect }: { person: Person; onSelect: () => void }) {
  const category = personCategory(person)
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group flex flex-col rounded-lg border border-slate-300 bg-white p-2 text-left transition hover:border-blue-400 hover:bg-blue-50/30"
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
        {person.facePhoto ? (
          <img src={person.facePhoto} alt="" className="h-full w-full object-cover" />
        ) : (
          <span
            aria-hidden
            className="flex h-full w-full items-center justify-center text-2xl font-bold text-slate-400"
          >
            {person.name.trim().charAt(0) || '?'}
          </span>
        )}
        {person.followUp && (
          <span className="absolute left-1 top-1">
            <StatusLabel type="warning">要フォロー</StatusLabel>
          </span>
        )}
      </div>
      <p className="mt-1.5 truncate text-sm font-semibold text-slate-800">
        {person.name || '(名前未設定)'}
      </p>
      {person.company && (
        <p className="mt-0.5 truncate text-xs text-slate-500">{person.company}</p>
      )}
      <div className="mt-1">
        <CategoryBadge category={category} />
      </div>
    </button>
  )
}

export function PeopleView({
  people,
  onSelectPerson,
}: {
  people: Person[]
  /** 人をクリックしたとき(詳細ポップアップを開く) */
  onSelectPerson: (person: Person) => void
}) {
  const [query, setQuery] = useState('')
  const [company, setCompany] = useState('') // '' = すべての会社
  const [category, setCategory] = useState('') // '' = 全員
  const [month, setMonth] = useState('') // '' = すべての時期

  // データに存在する会社・年月からセレクトの選択肢を導出する
  const companyOptions = useMemo(
    () => [
      { value: '', label: 'すべての会社' },
      ...distinctCompanies(people).map((c) => ({ value: c, label: c })),
    ],
    [people],
  )
  const monthOptions = useMemo(
    () => [
      { value: '', label: 'すべての時期' },
      ...distinctMonths(people).map((m) => ({ value: m, label: m })),
    ],
    [people],
  )
  const categoryOptions = [
    { value: '', label: '全員' },
    ...CATEGORIES.map((c) => ({ value: c, label: c })),
  ]

  // 検索語 + 会社 + 種別 + 出会った時期 を AND で適用する
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return people.filter((p) => {
      if (company && p.company.trim() !== company) return false
      if (category && personCategory(p) !== category) return false
      if (month && metMonth(p) !== month) return false
      if (!q) return true
      return [p.name, p.company, p.role, p.metAt, p.howMet, p.notes]
        .filter(Boolean)
        .some((s) => s.toLowerCase().includes(q))
    })
  }, [people, query, company, category, month])

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-5 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
        <Input
          type="search"
          width="100%"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="名前・会社・肩書き・メモで検索"
          className="sm:max-w-xs"
        />
        <Select
          width="100%"
          value={company}
          options={companyOptions}
          onChangeValue={setCompany}
          className="sm:w-auto"
          aria-label="会社で絞り込む"
        />
        <Select
          width="100%"
          value={category}
          options={categoryOptions}
          onChangeValue={setCategory}
          className="sm:w-auto"
          aria-label="属性・種別で絞り込む"
        />
        <Select
          width="100%"
          value={month}
          options={monthOptions}
          onChangeValue={setMonth}
          className="sm:w-auto"
          aria-label="出会った時期で絞り込む"
        />
        <span className="text-xs text-slate-400 sm:ml-auto">{filtered.length}人</span>
      </div>

      {people.length === 0 ? (
        <p className="py-16 text-center text-sm text-slate-400">
          まだ登録がありません。右上の「登録」から、面接や説明会で会った人を追加しましょう
        </p>
      ) : filtered.length === 0 ? (
        <p className="py-16 text-center text-sm text-slate-400">
          条件に合う人がいません。検索語やフィルタを変えてみてください
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7">
          {filtered.map((p) => (
            <PersonCell key={p.id} person={p} onSelect={() => onSelectPerson(p)} />
          ))}
        </div>
      )}
    </main>
  )
}
