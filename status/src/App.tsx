import type { Selection } from '@katazuku/data'
import { AppNav } from './components/AppNav'
import { DataState } from './components/DataState'
import { TrackCard } from './components/TrackCard'
import { useKatazukuData } from './lib/useKatazukuData'

export default function App() {
  const { data, error, loading, reload, setKey } = useKatazukuData()
  const tracks = [...(data?.selections || [])].sort((a, b) => {
    const terminal = (value: Selection) => ['不合格', '辞退', '終了'].includes(value.outcome)
    return Number(terminal(a)) - Number(terminal(b)) || a.company.localeCompare(b.company, 'ja')
  })
  const active = tracks.filter((track) => !['不合格', '辞退', '終了'].includes(track.outcome))

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 md:flex">
      <AppNav current="status" />
      <main className="min-w-0 flex-1 px-4 py-6 pb-24 md:px-8 md:py-8">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div><p className="text-xs font-bold tracking-wide text-blue-700">STATUS</p><h1 className="mt-1 text-2xl font-bold">選考管理</h1><p className="mt-1 text-sm text-slate-600">DB正本の選考トラックを読み取り専用で表示します。</p></div>
          <button type="button" onClick={reload} className="rounded-md border border-slate-400 bg-white px-3 py-2 text-sm font-bold hover:bg-slate-100">再読込</button>
        </header>
        {!data ? <DataState loading={loading} error={error} onSaveKey={setKey} /> : (
          <>
            <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[['全トラック', tracks.length], ['進行中', active.length], ['合格・内定', tracks.filter((t) => ['合格', '内定'].includes(t.outcome)).length], ['終了', tracks.length - active.length]].map(([label, count]) => (
                <div key={String(label)} className="rounded-xl border border-slate-300 bg-white p-4"><p className="text-xs text-slate-600">{label}</p><p className="mt-1 text-2xl font-bold">{count}</p></div>
              ))}
            </div>
            <section className="grid gap-4 xl:grid-cols-2" aria-label="選考トラック">
              {tracks.map((track) => <TrackCard key={track.id} track={track} />)}
            </section>
          </>
        )}
      </main>
    </div>
  )
}
