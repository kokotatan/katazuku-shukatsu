import { useEffect, useMemo, useState } from 'react'
import { Button, Input, StatusLabel, Textarea } from 'smarthr-ui'
import { KIND_META, type PrepEntry, type PrepKind } from './types'
import { companySummary, focusDeck, retrospectives } from './lib/select'
import { sameCompany } from './lib/names'
import { AppNav } from './components/AppNav'

const STORAGE_KEY = 'katazuku-prep/entries'
const PIPELINE_KEY = 'katazuku-pipeline/companies'

function load(): PrepEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw !== null) return JSON.parse(raw) as PrepEntry[]
  } catch {
    // 壊れたデータは空扱い
  }
  return []
}

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

type View =
  | { mode: 'home' }
  | { mode: 'company'; company: string }
  | { mode: 'focus'; company: string }

export default function App() {
  const [entries, setEntries] = useState<PrepEntry[]>(load)
  const [view, setView] = useState<View>(() => {
    const company = new URLSearchParams(window.location.search).get('company')
    return company ? { mode: 'company', company } : { mode: 'home' }
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  }, [entries])

  const add = (entry: Omit<PrepEntry, 'id' | 'updatedAt'>) =>
    setEntries((prev) => [
      { ...entry, id: `p-${Date.now()}`, updatedAt: new Date().toISOString() },
      ...prev,
    ])
  const patch = (id: string, p: Partial<PrepEntry>) =>
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...p, updatedAt: new Date().toISOString() } : e)),
    )
  const remove = (id: string) => setEntries((prev) => prev.filter((e) => e.id !== id))

  return (
    <div className="flex min-h-screen">
      <AppNav current="prep" />
      <div className="min-h-screen min-w-0 flex-1 pb-14 md:pb-0">
      <header className="sticky top-0 z-10 border-b border-slate-300 bg-white">
        <div className="flex items-center gap-2.5 px-6 py-3">
          <h1 className="flex items-baseline gap-2.5">
            <span className="text-lg font-bold tracking-tight text-slate-900">面接準備</span>
            <span className="hidden text-xs font-normal text-slate-500 sm:inline">
              振り返りと想定問答を企業ごとに。
            </span>
          </h1>
          <div className="ml-auto flex items-center gap-2">
            {view.mode !== 'home' && (
              <Button size="S" variant="secondary" onClick={() => setView({ mode: 'home' })}>
                一覧へ
              </Button>
            )}
          </div>
        </div>
      </header>

      {view.mode === 'home' && (
        <Home entries={entries} onOpen={(company) => setView({ mode: 'company', company })} onAdd={add} />
      )}
      {view.mode === 'company' && (
        <Company
          entries={entries}
          company={view.company}
          onAdd={add}
          onPatch={patch}
          onRemove={remove}
          onFocus={() => setView({ mode: 'focus', company: view.company })}
        />
      )}
      {view.mode === 'focus' && (
        <Focus
          deck={focusDeck(entries, view.company)}
          company={view.company}
          onExit={() => setView({ mode: 'company', company: view.company })}
        />
      )}
      </div>
    </div>
  )
}

function EntryForm({ company, onAdd }: { company: string; onAdd: (e: Omit<PrepEntry, 'id' | 'updatedAt'>) => void }) {
  const [kind, setKind] = useState<PrepKind>(company ? 'qa' : 'axis')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const placeholder: Record<PrepKind, [string, string]> = {
    qa: ['想定質問(例: なぜこの会社?)', '自分の答え'],
    retro: ['場面(例: 〇〇の一次面接)', '何が起きたか・次どうするか'],
    axis: ['テーマ(例: 就活の軸)', '自分の言葉で'],
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!question.trim() && !answer.trim()) return
        onAdd({ company: kind === 'axis' ? '' : company, kind, question: question.trim(), answer: answer.trim() })
        setQuestion('')
        setAnswer('')
      }}
      className="mb-6 rounded-lg border border-slate-300 bg-white p-4"
    >
      <div className="mb-2 flex gap-1">
        {(Object.keys(KIND_META) as PrepKind[]).map((k) => (
          <Button
            key={k}
            type="button"
            size="S"
            variant={kind === k ? 'primary' : 'secondary'}
            onClick={() => setKind(k)}
          >
            {KIND_META[k].label}
          </Button>
        ))}
      </div>
      <Input
        width="100%"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder={placeholder[kind][0]}
        className="mb-2 font-semibold"
      />
      <Textarea
        width="100%"
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        rows={3}
        placeholder={placeholder[kind][1]}
        className="mb-2"
      />
      <Button type="submit" variant="primary">
        追加
      </Button>
    </form>
  )
}

function EntryRow({ entry, onPatch, onRemove }: { entry: PrepEntry; onPatch: (p: Partial<PrepEntry>) => void; onRemove: () => void }) {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <li className="border-b border-slate-100 py-3">
        <Input
          width="100%"
          value={entry.question}
          onChange={(e) => onPatch({ question: e.target.value })}
          className="mb-1.5 font-semibold"
        />
        <Textarea
          width="100%"
          value={entry.answer}
          onChange={(e) => onPatch({ answer: e.target.value })}
          rows={3}
          className="mb-1.5"
        />
        <Button size="S" variant="text" onClick={() => setEditing(false)}>
          閉じる
        </Button>
      </li>
    )
  }
  return (
    <li className="group border-b border-slate-100 py-3">
      <div className="flex items-baseline gap-2">
        <span className="shrink-0">
          <StatusLabel type="grey">{KIND_META[entry.kind].label}</StatusLabel>
        </span>
        <button onClick={() => setEditing(true)} className="min-w-0 flex-1 text-left">
          <p className="text-sm font-semibold text-slate-800">{entry.question || '(無題)'}</p>
          <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-500">{entry.answer}</p>
        </button>
        <button
          onClick={() => { if (window.confirm('削除しますか?')) onRemove() }}
          className="shrink-0 text-xs text-slate-300 transition group-hover:text-red-600"
        >
          削除
        </button>
      </div>
    </li>
  )
}

function Home({
  entries,
  onOpen,
  onAdd,
}: {
  entries: PrepEntry[]
  onOpen: (company: string) => void
  onAdd: (e: Omit<PrepEntry, 'id' | 'updatedAt'>) => void
}) {
  const [companyDraft, setCompanyDraft] = useState('')
  const summary = useMemo(() => companySummary(entries), [entries])
  const retros = useMemo(() => retrospectives(entries), [entries])
  const axes = entries.filter((e) => e.kind === 'axis')
  const options = useMemo(pipelineNames, [])

  return (
    <main className="max-w-3xl px-6 py-6">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (companyDraft.trim()) onOpen(companyDraft.trim())
        }}
        className="mb-6 flex gap-2"
      >
        <div className="flex-1">
          <Input
            width="100%"
            value={companyDraft}
            onChange={(e) => setCompanyDraft(e.target.value)}
            list="company-options"
            placeholder="企業名を入れて対策ノートを開く(選考ボードから補完)"
          />
        </div>
        <datalist id="company-options">
          {options.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <Button type="submit" variant="primary">
          開く
        </Button>
      </form>

      {summary.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-2 border-b border-slate-200 pb-1.5 text-base font-semibold text-slate-800">
            企業別ノート
          </h2>
          <ul className="flex flex-wrap gap-2 pt-2">
            {summary.map((g) => (
              <li key={g.company}>
                <Button
                  size="S"
                  variant="secondary"
                  onClick={() => onOpen(g.company)}
                  suffix={<StatusLabel type="grey">{g.count}</StatusLabel>}
                >
                  {g.company}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mb-8">
        <h2 className="mb-2 border-b border-slate-200 pb-1.5 text-base font-semibold text-slate-800">
          就活の軸(全社共通)
        </h2>
        <EntryForm company="" onAdd={onAdd} />
        {axes.length === 0 && (
          <p className="text-sm text-slate-400">「自分は何で会社を選ぶのか」を一行ずつ。面接直前モードの最初に出ます</p>
        )}
        <ul>
          {axes.map((e) => (
            <li key={e.id} className="border-b border-slate-100 py-3">
              <p className="text-sm font-semibold text-slate-800">{e.question}</p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-500">{e.answer}</p>
            </li>
          ))}
        </ul>
      </section>

      {retros.length > 0 && (
        <section>
          <h2 className="mb-2 border-b border-slate-200 pb-1.5 text-base font-semibold text-slate-800">
            振り返りの横断ビュー
            <span className="ml-2 text-xs font-normal text-slate-400">同じ失敗を繰り返していないか</span>
          </h2>
          <ul>
            {retros.map((e) => (
              <li key={e.id} className="border-b border-slate-100 py-3">
                <p className="text-xs text-slate-400">{e.company}</p>
                <p className="text-sm font-semibold text-slate-800">{e.question}</p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-500">{e.answer}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}

function Company({
  entries,
  company,
  onAdd,
  onPatch,
  onRemove,
  onFocus,
}: {
  entries: PrepEntry[]
  company: string
  onAdd: (e: Omit<PrepEntry, 'id' | 'updatedAt'>) => void
  onPatch: (id: string, p: Partial<PrepEntry>) => void
  onRemove: (id: string) => void
  onFocus: () => void
}) {
  const mine = entries.filter((e) => e.company && sameCompany(e.company, company))
  return (
    <main className="max-w-3xl px-6 py-6">
      <div className="mb-4 flex items-baseline gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">{company}</h1>
        <Button className="ml-auto" variant="primary" onClick={onFocus}>
          直前モードを開始
        </Button>
      </div>
      <EntryForm company={company} onAdd={onAdd} />
      {mine.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-400">
          まだ何もありません。面接後の振り返りと、聞かれそうな質問への答えを貯めましょう
        </p>
      ) : (
        <ul>
          {mine.map((e) => (
            <EntryRow key={e.id} entry={e} onPatch={(p) => onPatch(e.id, p)} onRemove={() => onRemove(e.id)} />
          ))}
        </ul>
      )}
    </main>
  )
}

function Focus({ deck, company, onExit }: { deck: PrepEntry[]; company: string; onExit: () => void }) {
  const [index, setIndex] = useState(0)
  const [showAnswer, setShowAnswer] = useState(false)

  useEffect(() => {
    const handler = (ev: KeyboardEvent) => {
      const key = ev.key.toLowerCase()
      if (key === 'escape') onExit()
      if (key === 'j' || key === 'enter' || key === 'arrowright' || key === ' ') {
        ev.preventDefault()
        if (!showAnswer) setShowAnswer(true)
        else if (index < deck.length - 1) {
          setIndex(index + 1)
          setShowAnswer(false)
        } else onExit()
      }
      if (key === 'k' || key === 'arrowleft') {
        if (index > 0) {
          setIndex(index - 1)
          setShowAnswer(false)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })

  if (deck.length === 0) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-24 text-center">
        <p className="text-xl text-slate-700">読むものがまだありません</p>
        <p className="mt-2 text-sm text-slate-400">軸と想定問答を追加してから直前モードを使ってください</p>
        <div className="mt-6">
          <Button variant="secondary" onClick={onExit}>
            戻る
          </Button>
        </div>
      </main>
    )
  }

  const entry = deck[index]
  return (
    <main
      className="mx-auto flex min-h-[80vh] max-w-2xl cursor-pointer flex-col justify-center px-6 py-12"
      onClick={() => {
        if (!showAnswer) setShowAnswer(true)
        else if (index < deck.length - 1) {
          setIndex(index + 1)
          setShowAnswer(false)
        } else onExit()
      }}
    >
      <p className="mb-6 text-xs tracking-widest text-slate-400">
        {company} 直前モード {index + 1} / {deck.length}
        <span className="ml-3">{KIND_META[entry.kind].label}</span>
      </p>
      <h1 className="text-3xl font-semibold leading-relaxed tracking-wide text-slate-900">
        {entry.question || '(無題)'}
      </h1>
      {showAnswer ? (
        <p className="mt-8 whitespace-pre-wrap text-base leading-loose text-slate-600">{entry.answer}</p>
      ) : (
        <p className="mt-8 text-sm text-slate-400">クリック / Enter で自分の答えを表示</p>
      )}
      <p className="mt-12 text-[11px] text-slate-300">J・Enter: 次へ / K: 戻る / Esc: 終了</p>
    </main>
  )
}
