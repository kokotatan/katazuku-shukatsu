import { useEffect, useRef, useState } from 'react'
import { Button } from 'smarthr-ui'
import type { Person } from './types'
import { loadPeople, newPersonId, savePeople } from './lib/people'
import { AppNav } from './components/AppNav'
import { PeopleView } from './components/PeopleView'

type FormValue = Omit<Person, 'id' | 'updatedAt'>

export default function App() {
  const [people, setPeople] = useState<Person[]>(loadPeople)
  const [toast, setToast] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    savePeople(people)
  }, [people])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  const add = (v: FormValue) =>
    setPeople((prev) => [{ ...v, id: newPersonId(), updatedAt: new Date().toISOString() }, ...prev])
  const update = (id: string, v: FormValue) =>
    setPeople((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...v, updatedAt: new Date().toISOString() } : p)),
    )
  const remove = (id: string) => setPeople((prev) => prev.filter((p) => p.id !== id))

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(people, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `people-export-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const importJson = async (file: File) => {
    try {
      const data = JSON.parse(await file.text()) as Person[]
      if (!Array.isArray(data)) throw new Error('配列ではありません')
      const known = new Set(people.map((p) => p.id))
      const fresh = data.filter((p) => p.id && !known.has(p.id))
      setPeople((prev) => [...fresh, ...prev])
      setToast(`${fresh.length}件を取り込みました`)
    } catch (err) {
      setToast(`インポート失敗: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <div className="flex min-h-screen">
      <AppNav current="people" />
      <div className="min-h-screen min-w-0 flex-1 pb-14 md:pb-0">
        <header className="sticky top-0 z-10 border-b border-slate-300 bg-white">
          <div className="flex items-center gap-2.5 px-6 py-3">
            <h1 className="flex items-baseline gap-2.5">
              <span className="text-lg font-bold tracking-tight text-slate-900">人</span>
              <span className="hidden text-xs font-normal text-slate-500 sm:inline">
                選考で会った人を、顔と前回話したことで覚える。
              </span>
            </h1>
            <div className="ml-auto flex items-center gap-2 text-sm">
              <Button size="S" variant="secondary" onClick={() => fileInput.current?.click()}>
                インポート
              </Button>
              <Button size="S" variant="secondary" onClick={exportJson}>
                エクスポート
              </Button>
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

        <PeopleView people={people} onAdd={add} onUpdate={update} onRemove={remove} />

        {toast && (
          <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-slate-800 px-5 py-2.5 text-sm font-medium text-white shadow-lg">
            {toast}
          </div>
        )}
      </div>
    </div>
  )
}
