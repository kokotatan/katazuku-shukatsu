import { useMemo, useRef, useState } from 'react'
import { Button, Checkbox, Input, StatusLabel, Textarea } from 'smarthr-ui'
import type { Person } from '../types'
import { sameCompany } from '../lib/names'
import { readFileAsDataURL } from '../lib/image'

const PIPELINE_KEY = 'katazuku-pipeline/companies'

function pipelineNames(): string[] {
  try {
    const raw = localStorage.getItem(PIPELINE_KEY)
    if (raw !== null) {
      return (JSON.parse(raw) as { name?: string }[]).map((c) => c.name ?? '').filter(Boolean)
    }
  } catch {
    // なければ空
  }
  return []
}

/** 顔サムネイル。無ければ頭文字フォールバック */
function Face({ person, size = 40 }: { person: Person; size?: number }) {
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

type FormValue = Omit<Person, 'id' | 'updatedAt'>

const EMPTY: FormValue = {
  name: '',
  company: '',
  role: '',
  metAt: '',
  howMet: '',
  notes: '',
  facePhoto: undefined,
  followUp: false,
}

function PersonForm({
  initial,
  companyOptions,
  onSave,
  onCancel,
}: {
  initial: FormValue
  companyOptions: string[]
  onSave: (v: FormValue) => void
  onCancel?: () => void
}) {
  const [v, setV] = useState<FormValue>(initial)
  const faceInput = useRef<HTMLInputElement>(null)
  const set = (p: Partial<FormValue>) => setV((prev) => ({ ...prev, ...p }))
  const labelCls = 'flex flex-col gap-1 text-xs font-semibold text-slate-500'

  const pickFace = async (file: File) => {
    try {
      set({ facePhoto: await readFileAsDataURL(file, 256) })
    } catch {
      // 読み込み失敗時は据え置き
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!v.name.trim()) return
        onSave({
          ...v,
          name: v.name.trim(),
          company: v.company.trim(),
          role: v.role.trim(),
          metAt: v.metAt.trim(),
          howMet: v.howMet.trim(),
          notes: v.notes.trim(),
        })
      }}
      className="mb-6 rounded-lg border border-slate-300 bg-white p-4"
    >
      <div className="mb-3 flex items-center gap-3">
        <Face person={{ ...v, id: '', updatedAt: '' }} size={56} />
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Button size="S" variant="secondary" type="button" onClick={() => faceInput.current?.click()}>
              顔写真を選ぶ
            </Button>
            {v.facePhoto && (
              <Button size="S" variant="text" type="button" onClick={() => set({ facePhoto: undefined })}>
                削除
              </Button>
            )}
          </div>
          <p className="text-[11px] text-slate-400">顔を覚えるための小さな写真(長辺256pxに縮小)</p>
        </div>
        <input
          ref={faceInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) pickFace(f)
            e.target.value = ''
          }}
        />
      </div>

      <div className="mb-2 flex gap-2">
        <label className={`flex-1 ${labelCls}`}>
          名前 *
          <Input width="100%" value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder="山田 太郎" />
        </label>
        <label className={`flex-1 ${labelCls}`}>
          企業
          <Input
            width="100%"
            value={v.company}
            onChange={(e) => set({ company: e.target.value })}
            list="people-company-options"
            placeholder="株式会社○○"
          />
        </label>
      </div>
      <datalist id="people-company-options">
        {companyOptions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      <div className="mb-2 flex gap-2">
        <label className={`flex-1 ${labelCls}`}>
          部署・肩書き
          <Input width="100%" value={v.role} onChange={(e) => set({ role: e.target.value })} placeholder="人事 / エンジニア など" />
        </label>
        <label className={`flex-1 ${labelCls}`}>
          出会った場面
          <Input width="100%" value={v.metAt} onChange={(e) => set({ metAt: e.target.value })} placeholder="7/16 二次面接 など" />
        </label>
      </div>

      <label className={`mb-2 ${labelCls}`}>
        どこでどう会ったか
        <Input width="100%" value={v.howMet} onChange={(e) => set({ howMet: e.target.value })} placeholder="オンライン面接で / 説明会で声をかけた など" />
      </label>

      <label className={`mb-2 ${labelCls}`}>
        話したこと・人柄・刺さった言葉
        <Textarea
          width="100%"
          value={v.notes}
          onChange={(e) => set({ notes: e.target.value })}
          rows={3}
          placeholder="次に会うときに思い出したいこと"
        />
      </label>

      <div className="mb-3">
        <Checkbox checked={v.followUp} onChange={(e) => set({ followUp: e.target.checked })}>
          お礼・連絡が必要
        </Checkbox>
      </div>

      <div className="flex gap-2">
        <Button type="submit" variant="primary">
          {onCancel ? '保存' : '追加'}
        </Button>
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            キャンセル
          </Button>
        )}
      </div>
    </form>
  )
}

function PersonRow({
  person,
  onEdit,
  onRemove,
}: {
  person: Person
  onEdit: () => void
  onRemove: () => void
}) {
  return (
    <li className="group flex items-start gap-3 border-b border-slate-100 py-3">
      <Face person={person} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <p className="text-sm font-semibold text-slate-800">{person.name}</p>
          {person.role && <span className="text-xs text-slate-400">{person.role}</span>}
          {person.followUp && (
            <span className="shrink-0">
              <StatusLabel type="warning">要フォロー</StatusLabel>
            </span>
          )}
        </div>
        {(person.metAt || person.howMet) && (
          <p className="mt-0.5 text-xs text-slate-400">
            {[person.metAt, person.howMet].filter(Boolean).join(' / ')}
          </p>
        )}
        {person.notes && (
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">{person.notes}</p>
        )}
      </div>
      <div className="flex shrink-0 flex-col gap-1">
        <button onClick={onEdit} className="text-xs text-slate-400 transition hover:text-blue-600">
          編集
        </button>
        <button
          onClick={() => {
            if (window.confirm(`「${person.name}」を削除しますか?`)) onRemove()
          }}
          className="text-xs text-slate-300 transition hover:text-red-600"
        >
          削除
        </button>
      </div>
    </li>
  )
}

export function PeopleView({
  people,
  onAdd,
  onUpdate,
  onRemove,
}: {
  people: Person[]
  onAdd: (v: FormValue) => void
  onUpdate: (id: string, v: FormValue) => void
  onRemove: (id: string) => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)

  const companyOptions = useMemo(() => {
    const set = new Set<string>(pipelineNames())
    for (const p of people) if (p.company) set.add(p.company)
    return [...set]
  }, [people])

  // 企業ごとにグルーピング(名寄せ)。会社未設定は末尾の「所属未設定」へ
  const groups = useMemo(() => {
    const gs: { company: string; members: Person[] }[] = []
    for (const p of people) {
      const key = p.company || ''
      const hit = gs.find((g) => (key ? sameCompany(g.company, key) : g.company === ''))
      if (hit) hit.members.push(p)
      else gs.push({ company: key, members: [p] })
    }
    return gs
  }, [people])

  return (
    <main className="max-w-3xl px-6 py-6">
      <p className="mb-4 text-sm text-slate-500">
        選考で会った人を、顔と「前回この人と話したこと」で覚える。次に会う前に見返せます。
      </p>

      {editingId === null && <PersonForm initial={EMPTY} companyOptions={companyOptions} onSave={onAdd} />}

      {people.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-400">
          まだ登録がありません。面接や説明会で会った人を追加しましょう
        </p>
      ) : (
        groups.map((g) => (
          <section key={g.company || '__none__'} className="mb-8">
            <h2 className="mb-2 border-b border-slate-200 pb-1.5 text-base font-semibold text-slate-800">
              {g.company || '所属未設定'}
              <span className="ml-2 text-xs font-normal text-slate-400">{g.members.length}人</span>
            </h2>
            <ul>
              {g.members.map((p) =>
                editingId === p.id ? (
                  <li key={p.id} className="py-2">
                    <PersonForm
                      initial={p}
                      companyOptions={companyOptions}
                      onSave={(v) => {
                        onUpdate(p.id, v)
                        setEditingId(null)
                      }}
                      onCancel={() => setEditingId(null)}
                    />
                  </li>
                ) : (
                  <PersonRow
                    key={p.id}
                    person={p}
                    onEdit={() => setEditingId(p.id)}
                    onRemove={() => onRemove(p.id)}
                  />
                ),
              )}
            </ul>
          </section>
        ))
      )}
    </main>
  )
}
