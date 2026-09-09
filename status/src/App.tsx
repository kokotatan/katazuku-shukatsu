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
    <div className="min-h-screen bg-white text-slate-900 md:flex">
      <AppNav current="status" />
      <main className="app-page min-w-0 flex-1 px-4 py-6 pb-24 md:px-8 md:py-8">
        <header className="mb-6 flex items-center justify-between gap-3">
          <div><h1 className="text-2xl font-bold">選考管理</h1></div>
          <button type="button" onClick={reload} disabled={loading} className="app-refresh" aria-live="polite">{loading ? '更新中…' : '更新'}</button>
        </header>
        {data && error && <p role="alert" className="mb-4 text-sm text-red-700">更新できませんでした。{error}</p>}
        {!data ? <DataState view="status" loading={loading} error={error} onSaveKey={setKey} /> : (
          <>
            <div className="app-metrics mb-6 grid grid-cols-2 gap-x-6 sm:grid-cols-4">
              {[['すべての選考', tracks.length], ['進行中', active.length], ['合格・内定', tracks.filter((t) => ['合格', '内定'].includes(t.outcome)).length], ['終了', tracks.length - active.length]].map(([label, count]) => (
                <div key={String(label)} className="app-metric"><p className="text-xs text-slate-600">{label}</p><p className="text-2xl font-bold">{count}</p></div>
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
