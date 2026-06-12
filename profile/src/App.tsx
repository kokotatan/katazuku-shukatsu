import { useEffect, useMemo, useRef, useState } from 'react'
import { KINDS, type Kind, type Snippet } from './types'
import { countChars, targetLabel } from './lib/count'

const STORAGE_KEY = 'katazuku-notes/snippets'
const PIPELINE_KEY = 'katazuku-pipeline/companies'

function load(): Snippet[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw !== null) return JSON.parse(raw) as Snippet[]
  } catch {
    // 壊れたデータは空扱い
  }
  return []
}

function pipelineCompanyNames(): string[] {
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

const ghostBtn =
  'rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50'

export default function App() {
  const [snippets, setSnippets] = useState<Snippet[]>(load)
  const [kind, setKind] = useState<Kind>('gakuchika')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snippets))
  }, [snippets])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  const list = useMemo(
    () => snippets.filter((s) => s.kind === kind).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [snippets, kind],
  )
  const editing = snippets.find((s) => s.id === editingId) ?? null

  const patch = (id: string, p: Partial<Snippet>) =>
    setSnippets((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...p, updatedAt: new Date().toISOString() } : s)),
    )

  const create = () => {
    const s: Snippet = {
      id: `s-${Date.now()}`,
      kind,
      title: '',
      body: '',
      targetChars: null,
      usedAt: [],
      updatedAt: new Date().toISOString(),
    }
    setSnippets((prev) => [s, ...prev])
    setEditingId(s.id)
  }

  const duplicate = (s: Snippet) => {
    const copy: Snippet = {
      ...s,
      id: `s-${Date.now()}`,
      title: `${s.title || '無題'}(複製)`,
      usedAt: [],
      updatedAt: new Date().toISOString(),
    }
    setSnippets((prev) => [copy, ...prev])
    setEditingId(copy.id)
    setToast('複製しました。文字数を変えて育ててください')
  }

  const remove = (id: string) => {
    if (!window.confirm('このスニペットを削除しますか?')) return
    setSnippets((prev) => prev.filter((s) => s.id !== id))
    setEditingId(null)
  }

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(snippets, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `profile-export-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const importJson = async (file: File) => {
    try {
      const data = JSON.parse(await file.text()) as Snippet[]
      if (!Array.isArray(data)) throw new Error('配列ではありません')
      const known = new Set(snippets.map((s) => s.id))
      const fresh = data.filter((s) => s.id && !known.has(s.id))
      setSnippets((prev) => [...fresh, ...prev])
      setToast(`${fresh.length}件を取り込みました`)
    } catch (err) {
      setToast(`インポート失敗: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-2.5 px-4 py-3">
          <span
            aria-hidden
            className="flex h-7 w-7 items-center justify-center rounded-[4px] bg-slate-900 pt-0.5 font-display text-[15px] font-semibold leading-none text-white"
          >
            片
          </span>
          <span className="flex items-baseline gap-2">
            <span className="font-display text-lg font-semibold tracking-tight text-slate-900">katazuku</span>
            <span className="text-[11px] font-semibold tracking-[0.25em] text-slate-400 uppercase">Profile</span>
          </span>
          <div className="ml-auto flex items-center gap-2 text-sm">
            <button onClick={() => fileInput.current?.click()} className={ghostBtn}>インポート</button>
            <button onClick={exportJson} className={ghostBtn}>エクスポート</button>
            <a href="/" className={ghostBtn}>katazuku</a>
            <input
              ref={fileInput}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void importJson(f)
                e.target.value = ''
              }}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6">
        {editing === null ? (
          <>
            <nav className="mb-4 flex gap-1 border-b border-slate-200">
              {KINDS.map((k) => (
                <button
                  key={k.key}
                  onClick={() => setKind(k.key)}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
                    kind === k.key
                      ? 'border-slate-900 font-semibold text-slate-900'
                      : 'border-transparent text-slate-400 hover:text-slate-600'
                  }`}
                >
                  {k.label}
                  <span className="ml-1.5 font-display text-xs text-slate-400">
                    {snippets.filter((s) => s.kind === k.key).length}
                  </span>
                </button>
              ))}
            </nav>

            <button
              onClick={create}
              className="mb-4 w-full rounded-xl border-2 border-dashed border-slate-300 py-2.5 text-sm font-medium text-slate-400 transition hover:border-slate-400 hover:text-slate-600"
            >
              + 新しい部品を書く
            </button>

            {list.length === 0 ? (
              <p className="py-16 text-center text-sm text-slate-400">
                まだ部品がありません。書いたESはここに貯めて使い回しましょう
              </p>
            ) : (
              <ul>
                {list.map((s) => {
                  const c = countChars(s.body)
                  return (
                    <li key={s.id}>
                      <button
                        onClick={() => setEditingId(s.id)}
                        className="flex w-full items-baseline gap-3 border-b border-slate-100 px-1 py-3 text-left transition hover:bg-slate-50"
                      >
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">
                          {s.title || '無題'}
                        </span>
                        <span className="shrink-0 font-display text-sm tabular-nums text-slate-500">{c.chars}字</span>
                        {s.usedAt.length > 0 && (
                          <span className="shrink-0 text-[11px] text-slate-400">{s.usedAt.length}社で使用</span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        ) : (
          <Editor
            snippet={editing}
            onPatch={(p) => patch(editing.id, p)}
            onBack={() => setEditingId(null)}
            onDuplicate={() => duplicate(editing)}
            onRemove={() => remove(editing.id)}
          />
        )}
      </main>

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-slate-800 px-5 py-2.5 text-sm font-medium text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}

function Editor({
  snippet,
  onPatch,
  onBack,
  onDuplicate,
  onRemove,
}: {
  snippet: Snippet
  onPatch: (p: Partial<Snippet>) => void
  onBack: () => void
  onDuplicate: () => void
  onRemove: () => void
}) {
  const [companyDraft, setCompanyDraft] = useState('')
  const c = countChars(snippet.body)
  const target = targetLabel(c.chars, snippet.targetChars)
  const companyOptions = useMemo(pipelineCompanyNames, [])

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <button onClick={onBack} className={ghostBtn}>一覧へ戻る</button>
        <button onClick={onDuplicate} className={ghostBtn}>複製</button>
        <button
          onClick={onRemove}
          className="ml-auto rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
        >
          削除
        </button>
      </div>

      <input
        value={snippet.title}
        onChange={(e) => onPatch({ title: e.target.value })}
        placeholder="タイトル(例: LayerXハッカソンの話・600字版)"
        className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold focus:border-slate-500 focus:outline-none"
      />

      <div className="mb-2 flex items-baseline gap-3 text-sm">
        <span className="font-display text-2xl font-semibold tabular-nums text-slate-900">{c.chars}</span>
        <span className="text-xs text-slate-400">字(改行除く) / 全角換算 {c.zenkaku}字</span>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-500">
          目標
          <select
            value={snippet.targetChars ?? ''}
            onChange={(e) => onPatch({ targetChars: e.target.value ? Number(e.target.value) : null })}
            className="rounded border border-slate-300 px-1.5 py-0.5 text-xs focus:outline-none"
          >
            <option value="">なし</option>
            {[200, 300, 400, 500, 600, 800, 1000].map((n) => (
              <option key={n} value={n}>{n}字</option>
            ))}
          </select>
        </label>
        {target && (
          <span className={`rounded px-1.5 py-0.5 text-xs font-bold tabular-nums ${
            target.over ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-600'
          }`}>
            {target.text}
          </span>
        )}
      </div>

      <textarea
        value={snippet.body}
        onChange={(e) => onPatch({ body: e.target.value })}
        rows={16}
        placeholder="ここに本文。改行は文字数に数えません"
        className="mb-4 w-full max-w-[65ch] resize-y rounded-lg border border-slate-300 px-4 py-3 text-sm leading-loose focus:border-slate-500 focus:outline-none"
      />

      <div className="border-t border-slate-200 pt-3">
        <p className="mb-2 text-xs font-semibold text-slate-500">使った企業</p>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {snippet.usedAt.map((name) => (
            <span key={name} className="rounded px-2 py-0.5 text-xs text-slate-600 ring-1 ring-slate-200">
              {name}
              <button
                onClick={() => onPatch({ usedAt: snippet.usedAt.filter((n) => n !== name) })}
                className="ml-1.5 text-slate-400 hover:text-red-600"
                aria-label={`${name}を外す`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const name = companyDraft.trim()
            if (name && !snippet.usedAt.includes(name)) onPatch({ usedAt: [...snippet.usedAt, name] })
            setCompanyDraft('')
          }}
          className="flex gap-2"
        >
          <input
            value={companyDraft}
            onChange={(e) => setCompanyDraft(e.target.value)}
            list="company-options"
            placeholder="企業名(選考ボードから補完)"
            className="w-64 rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
          />
          <datalist id="company-options">
            {companyOptions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <button type="submit" className={ghostBtn}>追加</button>
        </form>
      </div>
    </div>
  )
}
