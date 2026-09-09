import { useMemo } from 'react'
import { AnchorButton, Button, StatusLabel } from 'smarthr-ui'
import { AppNav } from './components/AppNav'
import { daysLeft, snapshotToAllData, type Appointment, type Track } from './lib/data'
import { DataState } from './components/DataState'
import { useKatazukuData } from './lib/useKatazukuData'

/**
 * 今日やること(To Do) — 朝いちばんに開くページ。
 * 正本DBのスナップショットを読むだけ。サインイン不要(合言葉を初回1回)。
 * agentがDBに書けば数秒後にここに映る。
 */

const WEEKDAYS = '日月火水木金土'

function fmtAt(a: Appointment): string {
  if (!a.atDate) return a.at
  const d = a.atDate
  const base = `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`
  return a.hasTime ? `${base} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` : base
}

function dueLabel(t: Track): string {
  const d = t.deadlineDate!
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`
}

function TrackSection({ title, tracks, urgent }: { title: string; tracks: Track[]; urgent?: boolean }) {
  if (tracks.length === 0) return null
  return (
    <section className="mb-8">
      <h2 className="mb-2 flex items-baseline gap-2 border-b border-slate-200 pb-1.5">
        <span className={`text-base font-semibold ${urgent ? 'text-red-600' : 'text-slate-800'}`}>{title}</span>
        <span className="text-sm text-slate-500">{tracks.length}</span>
      </h2>
      <ul>
        {tracks.map((t, i) => (
          <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-100 py-3">
            <span className="shrink-0 sm:w-28">
              {t.deadlineDate ? (
                <StatusLabel type={urgent ? 'error' : 'grey'} bold={urgent}>
                  {dueLabel(t)}
                  {daysLeft(t.deadlineDate) < 0 ? ` ${-daysLeft(t.deadlineDate)}日超過` : ''}
                </StatusLabel>
              ) : (
                <StatusLabel type="grey">待ち</StatusLabel>
              )}
            </span>
            <span className="min-w-0 break-words text-sm font-semibold text-slate-800">
              {t.company}
              {t.position && <span className="font-normal text-slate-500">({t.position})</span>}
            </span>
            <span className="min-w-0 basis-full text-sm text-slate-500 sm:flex-1">{t.nextAction || t.status}</span>
            <AnchorButton size="S" variant="text" href="/board/">
              開く
            </AnchorButton>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function App() {
  const { data: snapshot, error, loading, reload, setKey } = useKatazukuData()
  const data = useMemo(() => snapshot ? snapshotToAllData(snapshot) : null, [snapshot])

  const active = (data?.tracks ?? []).filter((t) => t.outcome !== '不合格' && t.outcome !== '辞退')
  const appts = data?.appointments ?? []
  const todayAppts = appts.filter((a) => a.atDate && daysLeft(a.atDate) === 0)
  const upcomingAppts = appts.filter((a) => a.atDate && daysLeft(a.atDate) > 0 && daysLeft(a.atDate) <= 7)
  const dated = active
    .filter((t) => t.deadlineDate && !t.submitted)
    .sort((a, b) => a.deadlineDate!.getTime() - b.deadlineDate!.getTime())
  const overdue = dated.filter((t) => daysLeft(t.deadlineDate!) < 0)
  const soon = dated.filter((t) => daysLeft(t.deadlineDate!) >= 0 && daysLeft(t.deadlineDate!) <= 2)
  const week = dated.filter((t) => daysLeft(t.deadlineDate!) > 2 && daysLeft(t.deadlineDate!) <= 7)
  const waiting = active.filter(
    (t) => !t.deadlineDate && /結果待ち|要確認|案内待ち|確定待ち|返信待ち/.test(t.status + t.nextAction),
  )

  return (
    <div className="min-h-screen md:flex">
      <AppNav current="insight" />
      <main className="app-page min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
        <header className="mb-6 flex flex-wrap items-center gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-800">今日やること</h1>
            <p className="text-xs text-slate-500"></p>
          </div>
          <span className="ml-auto text-xs text-slate-500">
            {data?.generatedAt
              ? `更新 ${data.generatedAt.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 時点`
              : ''}
          </span>
          <Button size="S" variant="secondary" onClick={reload} disabled={loading}>
              {loading ? '読込中…' : '更新'}
            </Button>
        </header>

        {!data && <DataState view="insight" loading={loading} error={error} onSaveKey={setKey} />}
        {data && error && <p role="alert" className="mb-4 text-sm text-red-700">更新できませんでした。{error}</p>}

        {data && (
          <>
            {(todayAppts.length > 0 || upcomingAppts.length > 0) && (
              <section className="mb-8">
                <h2 className="mb-2 border-b border-slate-200 pb-1.5 text-base font-semibold text-slate-800">
                  予定 <span className="text-sm font-normal text-slate-500">面接・締切・説明会</span>
                </h2>
                {[...todayAppts, ...upcomingAppts].map((a, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-100 py-3">
                    <span className="shrink-0 sm:w-36">
                      <StatusLabel type={daysLeft(a.atDate!) <= 0 ? 'error' : 'grey'} bold={daysLeft(a.atDate!) <= 0}>
                        {fmtAt(a)}
                      </StatusLabel>
                    </span>
                    <span className="min-w-0 break-words text-sm font-semibold text-slate-800">{a.company}</span>
                    <span className="min-w-0 basis-full text-sm text-slate-500 sm:flex-1">
                      {a.title}
                      {a.person && ` / ${a.person}`}
                      {a.location && ` @${a.location}`}
                    </span>
                    {a.url && (
                      <AnchorButton size="S" variant="primary" href={a.url} target="_blank">
                        開く
                      </AnchorButton>
                    )}
                  </div>
                ))}
              </section>
            )}
            <TrackSection title="期限切れ(至急・要判断)" tracks={overdue} urgent />
            <TrackSection title="今日〜あさって" tracks={soon} urgent />
            <TrackSection title="今週" tracks={week} />
            <TrackSection title="待ち(結果・案内)" tracks={waiting} />
            {overdue.length + soon.length + todayAppts.length === 0 && (
              <p className="border-t border-slate-200 py-6 text-sm text-slate-500">
                直近の締切・予定はありません。
              </p>
            )}
            {data.activities.length > 0 && (
              <section className="mt-10">
                <h2 className="mb-2 border-b border-slate-200 pb-1.5 text-sm font-semibold text-slate-500">
                  自動運転の直近の動き
                </h2>
                {data.activities.slice(0, 5).map((a, i) => (
                  <p key={i} className="border-b border-slate-100 py-1.5 text-xs text-slate-500">
                    <span className="text-slate-500">{a.ts}</span> {a.action}
                    {a.result && <span className="text-slate-500"> — {a.result}</span>}
                  </p>
                ))}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  )
}
