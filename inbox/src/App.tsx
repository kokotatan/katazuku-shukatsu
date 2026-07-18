import { formatDate } from '@katazuku/data'
import { AppNav } from './components/AppNav'
import { DataState } from './components/DataState'
import { useKatazukuData } from './lib/useKatazukuData'

export default function App() {
  const { data, error, loading, reload, setKey } = useKatazukuData()
  const mails = data?.mailItems || []
  const eventFeed = data?.enrichedEvents || []

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 md:flex">
      <AppNav current="inbox" />
      <main className="min-w-0 flex-1 px-4 py-6 pb-24 md:px-8 md:py-8">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold tracking-wide text-blue-700">INBOX</p>
            <h1 className="mt-1 text-2xl font-bold">メールと更新</h1>
            <p className="mt-1 text-sm text-slate-600">メール抽出結果をDBから読む画面です。人がここで状態を書き換えることはありません。</p>
          </div>
          <button type="button" onClick={reload} className="rounded-md border border-slate-400 bg-white px-3 py-2 text-sm font-bold hover:bg-slate-100">再読込</button>
        </header>

        {!data ? <DataState loading={loading} error={error} onSaveKey={setKey} /> : (
          <>
            <div className="mb-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-300 bg-white p-4"><p className="text-xs text-slate-600">DBメール</p><p className="mt-1 text-2xl font-bold">{mails.length}</p></div>
              <div className="rounded-xl border border-slate-300 bg-white p-4"><p className="text-xs text-slate-600">要対応</p><p className="mt-1 text-2xl font-bold text-red-700">{mails.filter((mail) => Boolean(mail.needsAction)).length}</p></div>
              <div className="rounded-xl border border-slate-300 bg-white p-4"><p className="text-xs text-slate-600">最終更新</p><p className="mt-2 text-sm font-bold">{formatDate(data.generatedAt)}</p></div>
            </div>

            <section className="space-y-3" aria-label="メール一覧">
              {mails.map((mail) => (
                <article key={mail.id} className="rounded-xl border border-slate-300 bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {Boolean(mail.needsAction) && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-800">要対応</span>}
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">{mail.category}</span>
                        {mail.company && <span className="text-xs font-bold text-blue-700">{mail.company}</span>}
                      </div>
                      <h2 className="mt-2 font-bold">{mail.subject}</h2>
                      <p className="mt-1 text-sm leading-6 text-slate-600">{mail.summary || mail.sender}</p>
                    </div>
                    <time className="shrink-0 text-xs text-slate-500">{formatDate(mail.receivedAt)}</time>
                  </div>
                  {mail.deadline && <p className="mt-3 border-t border-slate-200 pt-3 text-sm font-bold text-red-700">期限: {formatDate(mail.deadline)}</p>}
                </article>
              ))}
              {mails.length === 0 && (
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-5">
                  <p className="font-bold text-blue-900">正規化メールは次回同期から蓄積されます</p>
                  <p className="mt-1 text-sm text-blue-800">それまでは、直近のDB更新イベントを表示します。</p>
                </div>
              )}
              {mails.length === 0 && eventFeed.slice(0, 30).map((event) => (
                <article key={String(event.id)} className="rounded-xl border border-slate-300 bg-white p-4">
                  <div className="flex justify-between gap-3">
                    <div><p className="text-xs font-bold text-blue-700">{String(event.company || '')}</p><h2 className="mt-1 font-bold">{String(event.summary || '')}</h2><p className="mt-1 text-xs text-slate-500">{String(event.kind || '')}</p></div>
                    <time className="text-xs text-slate-500">{formatDate(String(event.at || ''))}</time>
                  </div>
                </article>
              ))}
            </section>
          </>
        )}
      </main>
    </div>
  )
}
