import { useState } from 'react'
import { formatDate } from '@katazuku/data'
import { AppNav } from './components/AppNav'
import { DataState } from './components/DataState'
import { useKatazukuData } from './lib/useKatazukuData'

export default function App() {
  const { data, error, loading, reload, setKey } = useKatazukuData()
  const [filter, setFilter] = useState<'all' | 'action'>('all')
  const mails = data?.mailItems || []
  const needsAction = mails.filter(mail => Boolean(mail.needsAction))
  const visible = filter === 'action' ? needsAction : mails
  const eventFeed = data?.enrichedEvents || []

  return <div className="min-h-screen bg-white text-slate-900 md:flex">
    <AppNav current="inbox" />
    <main className="app-page min-w-0 flex-1 px-4 py-6 pb-24 md:px-8 md:py-8">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">メールと更新</h1>
          {data && <p className="mt-2 text-xs text-slate-500">最終更新 <time>{formatDate(data.generatedAt)}</time></p>}
        </div>
        <button type="button" onClick={reload} disabled={loading} className="app-refresh" aria-live="polite">{loading ? '更新中…' : '更新'}</button>
      </header>

      {data && error && <p role="alert" className="mb-4 text-sm text-red-700">更新できませんでした。{error}</p>}

      {!data ? <DataState view="inbox" loading={loading} error={error} onSaveKey={setKey} /> : <>
        <div className="flex gap-6 border-b border-slate-300" role="group" aria-label="メールの絞り込み">
          {([['all', 'すべて', mails.length], ['action', '要対応', needsAction.length]] as const).map(([key, label, count]) => <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)} className={`-mb-px flex min-h-12 items-center gap-3 border-b-2 px-1 text-sm ${filter === key ? 'border-blue-500 font-semibold text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-900'}`}>{label}<span className="text-xs tabular-nums text-slate-500">{count}</span></button>)}
        </div>

        <section aria-label={filter === 'action' ? '要対応のメール' : 'メール一覧'} aria-busy={loading}>
          {visible.map(mail => <article key={mail.id} className="border-b border-slate-200 py-6">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              {Boolean(mail.needsAction) && <span className="font-semibold text-red-700">要対応</span>}
              {mail.company && <span className="font-semibold text-slate-700">{mail.company}</span>}
              {mail.category && <span>{mail.category}</span>}
              <time className="ml-auto">{formatDate(mail.receivedAt)}</time>
            </div>
            <h2 className="mt-2 break-words font-semibold leading-7">{mail.subject}</h2>
            <p className="mt-1 max-w-prose break-words text-sm leading-7 text-slate-600">{mail.summary || mail.sender}</p>
            {mail.deadline && <p className="mt-3 text-sm text-slate-700">期限 <time className="ml-2 font-semibold">{formatDate(mail.deadline)}</time></p>}
          </article>)}
          {!visible.length && <p role="status" className="py-12 text-sm text-slate-500">{filter === 'action' ? '対応が必要なメールはありません。' : 'メールはまだありません。'}</p>}
        </section>

        {!mails.length && eventFeed.length > 0 && <section className="mt-6" aria-labelledby="updates-title">
          <h2 id="updates-title" className="border-b border-slate-300 pb-4 text-base font-semibold">最近の更新</h2>
          {eventFeed.slice(0, 30).map(event => <article key={String(event.id)} className="border-b border-slate-200 py-5">
            <div className="flex flex-wrap justify-between gap-2 text-xs text-slate-500"><p>{String(event.company || '')}</p><time>{formatDate(String(event.at || ''))}</time></div>
            <h3 className="mt-2 break-words text-sm font-semibold leading-7">{String(event.summary || '')}</h3>
            {Boolean(event.kind) && <p className="mt-1 text-xs text-slate-500">{String(event.kind)}</p>}
          </article>)}
        </section>}
      </>}
    </main>
  </div>
}
