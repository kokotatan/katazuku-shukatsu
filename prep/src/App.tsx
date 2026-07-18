import { useState } from 'react'
import { formatDate, textValue } from '@katazuku/data'
import { AppNav } from './components/AppNav'
import { DataState } from './components/DataState'
import { useKatazukuData } from './lib/useKatazukuData'

export default function App() {
  const { data, error, loading, reload, setKey } = useKatazukuData()
  const upcoming = (data?.appointments || [])
    .filter((appointment) => appointment.status === '予定' && new Date(appointment.at).getTime() >= Date.now() - 60 * 60 * 1000)
    .sort((a, b) => a.at.localeCompare(b.at))
  const companies = Array.from(new Set([
    ...upcoming.map((appointment) => appointment.company),
    ...(data?.dossiers || []).map((dossier) => dossier.company),
  ])).filter(Boolean)
  const [selected, setSelected] = useState('')
  const company = selected || upcoming[0]?.company || companies[0] || ''
  const dossier = data?.dossiers.find((item) => item.company === company)
  const interviews = (data?.interviews || []).filter((item) => item.company === company)

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 md:flex">
      <AppNav current="prep" />
      <main className="min-w-0 flex-1 px-4 py-6 pb-24 md:px-8 md:py-8">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div><p className="text-xs font-bold tracking-wide text-blue-700">PREP</p><h1 className="mt-1 text-2xl font-bold">面接準備</h1><p className="mt-1 text-sm text-slate-600">予定・企業研究・過去面接を会社ごとに束ねます。</p></div>
          <button type="button" onClick={reload} className="rounded-md border border-slate-400 bg-white px-3 py-2 text-sm font-bold hover:bg-slate-100">再読込</button>
        </header>
        {!data ? <DataState loading={loading} error={error} onSaveKey={setKey} /> : (
          <>
            <section className="mb-5 grid gap-3 lg:grid-cols-2" aria-label="直近予定">
              {upcoming.slice(0, 4).map((appointment) => (
                <button key={appointment.id} type="button" onClick={() => setSelected(appointment.company)} className="rounded-xl border border-slate-300 bg-white p-4 text-left shadow-sm hover:border-blue-500">
                  <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-blue-700">{appointment.company}</p><h2 className="mt-1 font-bold">{appointment.title}</h2></div><time className="text-sm font-bold">{formatDate(appointment.at)}</time></div>
                  <p className="mt-2 text-sm text-slate-600">{[appointment.person, appointment.location].filter(Boolean).join(' / ') || appointment.kind}</p>
                </button>
              ))}
              {upcoming.length === 0 && <div className="rounded-xl border border-slate-300 bg-white p-5 text-sm text-slate-600">今後の予定はありません。</div>}
            </section>

            <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-slate-300 bg-white p-4">
              <label htmlFor="prep-company" className="text-sm font-bold">準備する会社</label>
              <select id="prep-company" value={company} onChange={(event) => setSelected(event.target.value)} className="min-w-56 rounded-md border border-slate-400 bg-white px-3 py-2 text-sm">
                {companies.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </div>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
              <section className="rounded-xl border border-slate-300 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-bold">企業研究</h2>{dossier && <time className="text-xs text-slate-500">{formatDate(dossier.researchedAt)}</time>}</div>
                {dossier ? (
                  <>
                    <p className="mt-4 whitespace-pre-wrap text-sm leading-7">{dossier.summary}</p>
                    <dl className="mt-5 grid gap-4 border-t border-slate-200 pt-5">
                      {Object.entries(dossier.facts).map(([key, value]) => <div key={key}><dt className="text-xs font-bold uppercase tracking-wide text-blue-700">{key}</dt><dd className="mt-1 whitespace-pre-wrap text-sm leading-6">{textValue(value)}</dd></div>)}
                    </dl>
                    <div className="mt-5 border-t border-slate-200 pt-4"><h3 className="text-sm font-bold">根拠</h3><ul className="mt-2 space-y-1">{dossier.sources.map((source, index) => <li key={source.url || index} className="text-sm">{source.url ? <a href={source.url} target="_blank" rel="noreferrer" className="text-blue-700 underline">{source.title || source.url}</a> : source.title}</li>)}</ul></div>
                  </>
                ) : <p className="mt-4 text-sm text-slate-500">この会社のdossierはまだありません。企業研究パイプライン実行後にここへ入ります。</p>}
              </section>
              <aside className="rounded-xl border border-slate-300 bg-white p-5 shadow-sm">
                <h2 className="font-bold">過去面接</h2>
                <div className="mt-4 space-y-4">
                  {interviews.map((interview) => <article key={interview.id} className="border-b border-slate-200 pb-4"><p className="text-xs text-slate-500">{formatDate(interview.occurredAt)}</p><h3 className="mt-1 text-sm font-bold">{interview.title}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{interview.summary}</p></article>)}
                  {interviews.length === 0 && <p className="text-sm text-slate-500">面接記録はまだありません。</p>}
                </div>
              </aside>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
