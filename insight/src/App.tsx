import { useEffect, useMemo, useState } from 'react'
import { AnchorButton, Button, StatusLabel } from 'smarthr-ui'
import type { InboxEmail, PipelineCompany, TodayItem } from './types'
import { aggregate, INBOX_KEY, loadJson, PIPELINE_KEY } from './lib/aggregate'
import { AppNav } from './components/AppNav'

const WEEKDAYS = '日月火水木金土'

function dueLabel(item: TodayItem, now: Date): string {
  const d = new Date(item.due)
  const sameDay = d.toDateString() === now.toDateString()
  const time = item.hasTime ? `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` : ''
  if (sameDay) return item.hasTime ? time : '今日中'
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})${time ? ` ${time}` : ''}`
}

function Section({
  title,
  items,
  urgent,
  now,
  onDone,
}: {
  title: string
  items: TodayItem[]
  urgent?: boolean
  now: Date
  onDone: (item: TodayItem) => void
}) {
  if (items.length === 0) return null
  return (
    <section className="mb-8">
      <h2 className="mb-2 flex items-baseline gap-2 border-b border-slate-200 pb-1.5">
        <span className={`font-display text-base font-semibold ${urgent ? 'text-red-600' : 'text-slate-800'}`}>
          {title}
        </span>
        <span className="font-display text-sm text-slate-400">{items.length}</span>
      </h2>
      <ul>
        {items.map((item) => (
          <li key={item.key} className="flex items-center gap-3 border-b border-slate-100 py-2.5">
            <span className="w-24 shrink-0 text-center">
              <StatusLabel type={urgent ? 'error' : 'grey'} bold={urgent}>
                {dueLabel(item, now)}
              </StatusLabel>
            </span>
            <span className="shrink-0 text-sm font-semibold text-slate-800">{item.company}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-slate-500">{item.title}</span>
            <StatusLabel type="grey">{item.source === 'inbox' ? 'メール' : 'ボード'}</StatusLabel>
            {item.source === 'inbox' && (
              <Button size="S" variant="secondary" onClick={() => onDone(item)}>
                片付けた
              </Button>
            )}
            <AnchorButton size="S" variant="text" href={item.source === 'inbox' ? '/inbox/' : '/status/'}>
              開く
            </AnchorButton>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function App() {
  const [emails, setEmails] = useState<InboxEmail[]>(() => loadJson<InboxEmail>(INBOX_KEY))
  const [companies, setCompanies] = useState<PipelineCompany[]>(() => loadJson<PipelineCompany>(PIPELINE_KEY))
  const [now, setNow] = useState(() => new Date())
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  // 他タブ(Inbox/Pipeline)の変更を開いたまま反映する
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === INBOX_KEY) setEmails(loadJson<InboxEmail>(INBOX_KEY))
      if (e.key === PIPELINE_KEY) setCompanies(loadJson<PipelineCompany>(PIPELINE_KEY))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const buckets = useMemo(() => aggregate(emails, companies, now), [emails, companies, now])

  const markDone = (item: TodayItem) => {
    const id = item.key.replace(/^inbox-/, '')
    const latest = loadJson<InboxEmail>(INBOX_KEY).map((e) =>
      e.id === id ? { ...e, status: 'done' as const, doneAt: new Date().toISOString() } : e,
    )
    localStorage.setItem(INBOX_KEY, JSON.stringify(latest))
    setEmails(latest)
    setToast('片付けました')
  }

  const dateLabel = `${now.getMonth() + 1}月${now.getDate()}日(${WEEKDAYS[now.getDay()]})`
  const empty = buckets.overdue.length + buckets.today.length + buckets.week.length === 0

  return (
    <div className="flex min-h-screen">
      <AppNav current="insight" />
      <div className="min-h-screen min-w-0 flex-1 pb-14 md:pb-0">
      <header className="sticky top-0 z-10 border-b border-slate-300 bg-white">
        <div className="flex items-center gap-2.5 px-6 py-3">
          <h1 className="flex items-baseline gap-2.5">
            <span className="text-lg font-bold tracking-tight text-slate-900">今日やること</span>
            <span className="hidden text-xs font-normal text-slate-500 sm:inline">
              朝いちばんに開くページ。
            </span>
          </h1>
          <span className="ml-auto text-sm font-bold text-slate-700">{dateLabel}</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        {empty ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white/60 py-20 text-center">
            <p className="font-display text-2xl font-semibold tracking-wide text-slate-800">
              今日は、もう何もない。
            </p>
            <p className="mt-2 text-sm text-slate-400">期限つきのタスクはすべて先の日付です</p>
          </div>
        ) : (
          <>
            <Section title="期限切れ" items={buckets.overdue} urgent now={now} onDone={markDone} />
            <Section title="今日" items={buckets.today} urgent now={now} onDone={markDone} />
            <Section title="今週" items={buckets.week} now={now} onDone={markDone} />
          </>
        )}

        <p className="mt-6 text-xs text-slate-400">
          7日より先: {buckets.laterCount}件
          {buckets.datelessCount > 0 && (
            <>
              {' '}/ 期限なしの要対応メール: {buckets.datelessCount}件(
              <a href="/inbox/" className="underline decoration-slate-300 underline-offset-2">Inboxで確認</a>)
            </>
          )}
        </p>
      </main>

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-slate-800 px-5 py-2.5 text-sm font-medium text-white shadow-lg">
          {toast}
        </div>
      )}
      </div>
    </div>
  )
}
