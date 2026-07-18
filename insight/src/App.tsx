import { useCallback, useEffect, useState } from 'react'
import { AnchorButton, Button, StatusLabel } from 'smarthr-ui'
import { AppNav } from './components/AppNav'
import { daysLeft, fetchAll, READ_KEY_STORAGE, type AllData, type Appointment, type Track } from './lib/data'

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
        <span className="text-sm text-slate-400">{tracks.length}</span>
      </h2>
      <ul>
        {tracks.map((t, i) => (
          <li key={i} className="flex items-center gap-3 border-b border-slate-100 py-2.5">
            <span className="w-28 shrink-0">
              {t.deadlineDate ? (
                <StatusLabel type={urgent ? 'error' : 'grey'} bold={urgent}>
                  {dueLabel(t)}
                  {daysLeft(t.deadlineDate) < 0 ? ` ${-daysLeft(t.deadlineDate)}日超過` : ''}
                </StatusLabel>
              ) : (
                <StatusLabel type="grey">待ち</StatusLabel>
              )}
            </span>
            <span className="shrink-0 text-sm font-semibold text-slate-800">
              {t.company}
              {t.position && <span className="font-normal text-slate-400">({t.position})</span>}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-slate-500">{t.nextAction || t.status}</span>
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
  const [keyInput, setKeyInput] = useState('')
  const [needKey, setNeedKey] = useState(false)
  const [data, setData] = useState<AllData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await fetchAll())
      setNeedKey(false)
    } catch (err) {
      if (err instanceof Error && err.message === 'KEY') setNeedKey(true)
      else setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const saveKey = () => {
    localStorage.setItem(READ_KEY_STORAGE, keyInput.trim())
    void load()
  }

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
    <div className="flex min-h-screen">
      <AppNav current="insight" />
      <main className="mx-auto w-full max-w-3xl p-6">
        <header className="mb-6 flex items-center gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-800">今日やること</h1>
            <p className="text-xs text-slate-400">朝いちばんに開くページ。DBの生きた予定と締切だけ</p>
          </div>
          <span className="ml-auto text-xs text-slate-400">
            {data?.generatedAt
              ? `DB ${data.generatedAt.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 時点`
              : ''}
          </span>
          {!needKey && (
            <Button size="S" variant="secondary" onClick={() => load()} disabled={loading}>
              {loading ? '読込中…' : '更新'}
            </Button>
          )}
        </header>

        {needKey && (
          <div className="flex max-w-md flex-col gap-3">
            <p className="text-sm text-slate-500">合言葉を入れると表示されます(この端末では今回だけ)。</p>
            <input
              className="rounded border border-slate-300 p-2 text-sm"
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="合言葉"
            />
            <div>
              <Button variant="primary" onClick={saveKey} disabled={!keyInput.trim()}>
                表示する
              </Button>
            </div>
          </div>
        )}

        {error && <p className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {!needKey && !data && !error && <p className="p-8 text-center text-sm text-slate-400">読み込んでいます…</p>}

        {data && (
          <>
            {(todayAppts.length > 0 || upcomingAppts.length > 0) && (
              <section className="mb-8">
                <h2 className="mb-2 border-b border-slate-200 pb-1.5 text-base font-semibold text-slate-800">
                  予定 <span className="text-sm font-normal text-slate-400">面接・締切・説明会</span>
                </h2>
                {[...todayAppts, ...upcomingAppts].map((a, i) => (
                  <div key={i} className="flex items-center gap-3 border-b border-slate-100 py-2.5">
                    <span className="w-36 shrink-0">
                      <StatusLabel type={daysLeft(a.atDate!) <= 0 ? 'error' : 'grey'} bold={daysLeft(a.atDate!) <= 0}>
                        {fmtAt(a)}
                      </StatusLabel>
                    </span>
                    <span className="shrink-0 text-sm font-semibold text-slate-800">{a.company}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-500">
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
              <p className="rounded-lg bg-green-50 p-4 text-sm text-slate-600">
                直近の締切・予定はありません。自動運転が監視中です。
              </p>
            )}
            {data.activities.length > 0 && (
              <section className="mt-10">
                <h2 className="mb-2 border-b border-slate-200 pb-1.5 text-sm font-semibold text-slate-500">
                  自動運転の直近の動き
                </h2>
                {data.activities.slice(0, 5).map((a, i) => (
                  <p key={i} className="border-b border-slate-100 py-1.5 text-xs text-slate-500">
                    <span className="text-slate-400">{a.ts}</span> {a.action}
                    {a.result && <span className="text-slate-400"> — {a.result}</span>}
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
