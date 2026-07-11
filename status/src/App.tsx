import { useEffect, useRef, useState } from 'react'
import { Button } from 'smarthr-ui'
import { STAGES, type Company, type Stage } from './types'
import { makeInitialCompanies } from './lib/demo'
import { mergeImport } from './lib/importer'
import { DEFAULT_SHEET_ID } from './lib/sheet'
import { CompanyCard } from './components/CompanyCard'
import { CompanyModal } from './components/CompanyModal'
import { SheetSyncModal } from './components/SheetSyncModal'

const STORAGE_KEY = 'katazuku-pipeline/companies'
// Inboxの「選考ボードへ」が先にデータを作っても初期データを失わないためのフラグ
const SEEDED_KEY = 'katazuku-pipeline/seeded'

function load(): Company[] {
  let stored: Company[] | null = null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw !== null) stored = JSON.parse(raw) as Company[]
  } catch {
    // 壊れたデータは初期値で上書き
  }
  if (localStorage.getItem(SEEDED_KEY)) return stored ?? []
  localStorage.setItem(SEEDED_KEY, '1')
  if (stored === null) return makeInitialCompanies()
  const names = new Set(stored.map((c) => c.name))
  return [...stored, ...makeInitialCompanies().filter((c) => !names.has(c.name))]
}

type ModalState =
  | { mode: 'closed' }
  | { mode: 'new'; stage: Stage }
  | { mode: 'edit'; company: Company }

export default function App() {
  const [companies, setCompanies] = useState<Company[]>(load)
  const [modal, setModal] = useState<ModalState>({ mode: 'closed' })
  const [dragOverStage, setDragOverStage] = useState<Stage | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [sheetSyncOpen, setSheetSyncOpen] = useState(false)
  const [clientId, setClientId] = useState(
    () => localStorage.getItem('katazuku-pipeline/google-client-id') ?? '',
  )
  const [sheetId, setSheetId] = useState(
    () => localStorage.getItem('katazuku-pipeline/sheet-id') ?? DEFAULT_SHEET_ID,
  )
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(companies))
  }, [companies])

  // 別タブ(Inboxの「選考ボードへ」)からの追加を開いたまま反映する
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || e.newValue === null) return
      try {
        setCompanies(JSON.parse(e.newValue) as Company[])
      } catch {
        // 他タブが壊れたデータを書いた場合は無視
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const moveTo = (id: string, stage: Stage) =>
    setCompanies((prev) =>
      prev.map((c) => (c.id === id ? { ...c, stage, updatedAt: new Date().toISOString() } : c)),
    )

  const save = (data: Omit<Company, 'id' | 'updatedAt'>) => {
    if (modal.mode === 'edit') {
      setCompanies((prev) =>
        prev.map((c) =>
          c.id === modal.company.id ? { ...c, ...data, updatedAt: new Date().toISOString() } : c,
        ),
      )
    } else {
      setCompanies((prev) => [
        ...prev,
        { ...data, id: `c-${Date.now()}`, updatedAt: new Date().toISOString() },
      ])
    }
    setModal({ mode: 'closed' })
  }

  const remove = () => {
    if (modal.mode !== 'edit') return
    setCompanies((prev) => prev.filter((c) => c.id !== modal.company.id))
    setModal({ mode: 'closed' })
  }

  const importJson = async (file: File) => {
    try {
      const result = mergeImport(companies, JSON.parse(await file.text()))
      setCompanies(result.companies)
      setToast(`${result.added}社を追加、${result.enriched}社の情報を補完しました`)
    } catch (err) {
      setToast(`インポート失敗: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(companies, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `katazuku-pipeline-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const active = companies.filter((c) => c.stage !== 'closed' && c.stage !== 'offer').length
  const interviews = companies.filter((c) => c.stage === 'interview').length
  const offers = companies.filter((c) => c.stage === 'offer').length

  // 列内は期限が近い順、期限なしは後ろ
  const sorted = (stage: Stage) =>
    companies
      .filter((c) => c.stage === stage)
      .sort((a, b) => {
        if (a.nextDate && b.nextDate) return a.nextDate.localeCompare(b.nextDate)
        if (a.nextDate) return -1
        if (b.nextDate) return 1
        return b.updatedAt.localeCompare(a.updatedAt)
      })

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-screen-2xl items-center gap-4 px-4 py-3">
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
                Status
              </span>
            </span>
            <span className="hidden border-l border-slate-200 pl-2.5 text-xs font-normal text-slate-400 sm:inline">
              選考状況、ぜんぶ見える。
            </span>
          </h1>
          <div className="ml-auto flex items-center gap-4 text-xs text-slate-500">
            <span>進行中 <b className="font-display text-base text-slate-900">{active}</b> 社</span>
            <span>面接 <b className="font-display text-base text-slate-900">{interviews}</b></span>
            <span>内定 <b className="font-display text-base text-slate-900">{offers}</b></span>
            <Button
              size="S"
              variant="secondary"
              onClick={() => fileInput.current?.click()}
              title="JSONファイルから企業を取り込みます(既存カードは壊さずマージ)"
            >
              インポート
            </Button>
            <Button size="S" variant="secondary" onClick={exportJson}>
              エクスポート
            </Button>
            <Button
              size="S"
              variant="primary"
              onClick={() => setSheetSyncOpen(true)}
              title="ボードの内容を選考管理シート(Googleスプレッドシート)に書き戻します"
            >
              シートに反映
            </Button>
            <a href="/" className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-600 transition hover:bg-slate-50">
              katazuku
            </a>
            <input
              ref={fileInput}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) importJson(f)
                e.target.value = ''
              }}
            />
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-x-auto px-4 py-5">
        <div className="mx-auto flex min-w-fit max-w-screen-2xl gap-3">
          {STAGES.map((stage) => {
            const list = sorted(stage.key)
            return (
              <section
                key={stage.key}
                onDragOver={(e) => { e.preventDefault(); setDragOverStage(stage.key) }}
                onDragLeave={() => setDragOverStage(null)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOverStage(null)
                  const id = e.dataTransfer.getData('text/company-id')
                  if (id) moveTo(id, stage.key)
                }}
                className={`flex w-60 shrink-0 flex-col rounded-2xl border-t-4 bg-slate-200/50 ${stage.accent} ${
                  dragOverStage === stage.key ? 'bg-slate-300/60 ring-2 ring-slate-400/40' : ''
                }`}
              >
                <div className="flex items-center gap-1.5 px-3 pt-3 pb-2">
                  <h2 className="font-display text-sm font-semibold text-slate-700">{stage.label}</h2>
                  <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-xs font-bold text-slate-500">
                    {list.length}
                  </span>
                </div>
                <div className="flex flex-1 flex-col gap-2 px-2.5 pb-2.5">
                  {list.map((company) => (
                    <CompanyCard
                      key={company.id}
                      company={company}
                      onClick={() => setModal({ mode: 'edit', company })}
                      onDragStart={(e) => e.dataTransfer.setData('text/company-id', company.id)}
                    />
                  ))}
                  <button
                    onClick={() => setModal({ mode: 'new', stage: stage.key })}
                    className="rounded-xl border-2 border-dashed border-slate-300 py-2 text-xs font-medium text-slate-400 transition hover:border-slate-400 hover:text-slate-600"
                  >
                    + 追加
                  </button>
                </div>
              </section>
            )
          })}
        </div>
      </main>

      <footer className="px-4 pb-4 text-center text-[11px] text-slate-400">
        カードをドラッグしてステージを移動 / カードをクリックで編集
      </footer>

      {modal.mode !== 'closed' && (
        <CompanyModal
          initial={modal.mode === 'edit' ? modal.company : { stage: modal.stage }}
          onSave={save}
          onDelete={modal.mode === 'edit' ? remove : undefined}
          onClose={() => setModal({ mode: 'closed' })}
        />
      )}

      {sheetSyncOpen && (
        <SheetSyncModal
          companies={companies}
          clientId={clientId}
          sheetId={sheetId}
          onSaveSettings={(cid, sid) => {
            setClientId(cid)
            setSheetId(sid)
            localStorage.setItem('katazuku-pipeline/google-client-id', cid)
            localStorage.setItem('katazuku-pipeline/sheet-id', sid)
          }}
          onDone={(message) => {
            setSheetSyncOpen(false)
            setToast(message)
          }}
          onClose={() => setSheetSyncOpen(false)}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-slate-800 px-5 py-2.5 text-sm font-medium text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}
