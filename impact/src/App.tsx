import { formatDate } from '@katazuku/data'
import { AppNav } from './components/AppNav'
import { DataState } from './components/DataState'
import { useKatazukuData } from './lib/useKatazukuData'

export default function App() {
  const { data, error, loading, reload, setKey } = useKatazukuData()
  const selections = data?.selections || []
  const automated = (data?.enrichedEvents || []).filter((event) => /daily-sync|calendar-sync|interview-digest|submit-agent/.test(String(event.source || '')))
  const active = selections.filter((selection) => !['不合格', '辞退', '終了'].includes(selection.outcome))
  const positive = selections.filter((selection) => ['合格', '内定'].includes(selection.outcome))
  const submissions = data?.submissions || []
  const activities = data?.activities || []

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 md:flex">
      <AppNav current="impact" />
      <main className="min-w-0 flex-1 px-4 py-6 pb-24 md:px-8 md:py-8">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div><p className="text-xs font-bold tracking-wide text-blue-700">IMPACT</p><h1 className="mt-1 text-2xl font-bold">自動運転の効果</h1><p className="mt-1 text-sm text-slate-600">推定時間ではなく、DBに残った処理件数と結果を表示します。</p></div>
          <button type="button" onClick={reload} className="rounded-md border border-slate-400 bg-white px-3 py-2 text-sm font-bold hover:bg-slate-100">再読込</button>
        </header>
        {!data ? <DataState loading={loading} error={error} onSaveKey={setKey} /> : (
          <>
            <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="主要指標">
              {[
                ['管理中トラック', selections.length],
                ['進行中', active.length],
                ['合格・内定', positive.length],
                ['自動処理イベント', automated.length],
              ].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-slate-300 bg-white p-5 shadow-sm"><p className="text-xs text-slate-600">{label}</p><p className="mt-2 text-3xl font-bold">{value}</p></div>)}
            </section>
            <section className="mt-5 grid gap-5 xl:grid-cols-2">
              <div className="rounded-xl border border-slate-300 bg-white p-5 shadow-sm">
                <h2 className="font-bold">入力パイプライン</h2>
                <dl className="mt-4 grid grid-cols-2 gap-3">
                  {[
                    ['メール・選考イベント', data.enrichedEvents.length],
                    ['カレンダー予定', data.appointments.length],
                    ['面接記録', data.interviews.length],
                    ['提出記録', submissions.length],
                    ['企業dossier', data.dossiers.length],
                    ['人物', data.people.length],
                  ].map(([label, value]) => <div key={String(label)} className="rounded-lg bg-slate-50 p-3"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 text-xl font-bold">{value}</dd></div>)}
                </dl>
              </div>
              <div className="rounded-xl border border-slate-300 bg-white p-5 shadow-sm">
                <h2 className="font-bold">結果内訳</h2>
                <div className="mt-4 space-y-3">
                  {['進行中', '合格', '内定', '不合格', '辞退'].map((outcome) => {
                    const count = selections.filter((selection) => selection.outcome === outcome).length
                    const width = selections.length ? Math.max(2, Math.round(count / selections.length * 100)) : 0
                    return <div key={outcome}><div className="mb-1 flex justify-between text-sm"><span>{outcome}</span><strong>{count}</strong></div><div className="h-2 rounded-full bg-slate-200"><div className="h-2 rounded-full bg-blue-600" style={{ width: `${width}%` }} /></div></div>
                  })}
                </div>
              </div>
            </section>
            <section className="mt-5 rounded-xl border border-slate-300 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3"><h2 className="font-bold">活動ログ</h2><span className="text-xs text-slate-500">{activities.length}件</span></div>
              <div className="mt-4 divide-y divide-slate-200">
                {activities.slice(0, 30).map((activity, index) => <article key={String(activity.at || index)} className="grid gap-1 py-3 sm:grid-cols-[8rem_1fr]"><time className="text-xs text-slate-500">{formatDate(String(activity.at || ''))}</time><div><p className="text-sm font-bold">{String(activity.what || '自律処理')}</p><p className="mt-1 text-xs leading-5 text-slate-600">{[activity.why, activity.how].filter(Boolean).map(String).join(' / ')}</p></div></article>)}
                {activities.length === 0 && <p className="py-4 text-sm text-slate-500">活動ログはまだありません。</p>}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  )
}
