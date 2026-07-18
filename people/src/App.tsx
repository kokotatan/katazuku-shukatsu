import { useEffect, useRef, useState } from 'react'
import { Button, FaPlusIcon } from 'smarthr-ui'
import type { Person } from './types'
import { loadPeople, mergePeople, newPersonId, savePeople } from './lib/people'
import { AppNav } from './components/AppNav'
import { PeopleView } from './components/PeopleView'
import { PersonDialog, type PersonInput } from './components/PersonDialog'
import { PersonDetail } from './components/PersonDetail'

/** モーダルの状態: 閉/新規追加/詳細表示/既存編集 */
type DialogState =
  | { mode: 'closed' }
  | { mode: 'add' }
  | { mode: 'view'; person: Person }
  | { mode: 'edit'; person: Person }

export default function App() {
  // 初期値は localStorage から読む。以降の変更は useEffect で必ず保存する
  const [people, setPeople] = useState<Person[]>(loadPeople)
  const [dialog, setDialog] = useState<DialogState>({ mode: 'closed' })
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

  const add = (v: PersonInput) => {
    setPeople((prev) => [
      { ...v, id: newPersonId(), updatedAt: new Date().toISOString() },
      ...prev,
    ])
    setDialog({ mode: 'closed' })
  }
  const update = (id: string, v: PersonInput) => {
    setPeople((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...v, updatedAt: new Date().toISOString() } : p)),
    )
    setDialog({ mode: 'closed' })
  }
  const remove = (id: string) => {
    setPeople((prev) => prev.filter((p) => p.id !== id))
    setDialog({ mode: 'closed' })
  }

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
      const data = JSON.parse(await file.text())
      if (!Array.isArray(data)) throw new Error('配列ではありません')
      const { merged, added, updated } = mergePeople(people, data as Partial<Person>[])
      setPeople(merged)
      const parts: string[] = []
      if (added > 0) parts.push(`${added}件を追加`)
      if (updated > 0) parts.push(`${updated}件を更新`)
      setToast(parts.length > 0 ? `${parts.join('、')}しました` : '追加・更新はありませんでした')
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
              <Button
                size="S"
                variant="primary"
                prefix={<FaPlusIcon />}
                onClick={() => setDialog({ mode: 'add' })}
              >
                登録
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

        <PeopleView
          people={people}
          onSelectPerson={(person) => setDialog({ mode: 'view', person })}
        />

        {dialog.mode === 'view' && (
          <PersonDetail
            person={dialog.person}
            onEdit={() => setDialog({ mode: 'edit', person: dialog.person })}
            onClose={() => setDialog({ mode: 'closed' })}
          />
        )}

        {(dialog.mode === 'add' || dialog.mode === 'edit') && (
          <PersonDialog
            initial={dialog.mode === 'edit' ? dialog.person : null}
            people={people}
            onSave={(v) =>
              dialog.mode === 'edit' ? update(dialog.person.id, v) : add(v)
            }
            onDelete={dialog.mode === 'edit' ? () => remove(dialog.person.id) : undefined}
            onClose={() => setDialog({ mode: 'closed' })}
          />
        )}

        {toast && (
          <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-slate-800 px-5 py-2.5 text-sm font-medium text-white shadow-lg">
            {toast}
          </div>
        )}
      </div>
    </div>
  )
}
