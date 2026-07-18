import { useCallback, useEffect, useState } from 'react'
import { Button } from 'smarthr-ui'
import { daysLeft, fetchAll, READ_KEY_STORAGE, type AllData, type Appointment, type Track } from './lib/data'

/**
 * katazuku 管理画面。正本DBのスナップショット(/api/data)を読むだけ。
 * サインイン不要 — 合言葉を初回に1回。agentが書けば数秒後にここに映る。
 */

type Tab = 'today' | 'tracks' | 'companies' | 'log'

function statusClass(s: string, outcome: string): string {
  if (outcome === '不合格' || outcome === '辞退') return 'bg-slate-100 text-slate-400'
  if (/要確認|結果待ち/.test(s)) return 'bg-amber-50'
  if (outcome === '合格' || outcome === '内定') return 'bg-green-50'
  return 'bg-white'
}

const WEEKDAYS = '日月火水木金土'

function fmtAt(a: Appointment): string {
  if (!a.atDate) return a.at
  const d = a.atDate
  const base = `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`
  return a.hasTime ? `${base} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` : base
}

function DeadlineBadge({ t }: { t: Track }) {
  if (!t.deadlineDate) return null
  const d = daysLeft(t.deadlineDate)
  const label = d < 0 ? `${-d}日超過` : d === 0 ? '今日' : `残り${d}日`
  const cls = d < 0 ? 'bg-red-100 text-red-700' : d <= 2 ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-500'
  return <span className={`ml-2 rounded px-1.5 py-0.5 text-xs font-bold ${cls}`}>{label}</span>
}

export default function App() {
  const [keyInput, setKeyInput] = useState('')
  const [needKey, setNeedKey] = useState(false)
  const [data, setData] = useState<AllData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<Tab>('today')
  const [openCompany, setOpenCompany] = useState<string | null>(null)

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

  if (needKey) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-500 text-xl font-bold text-white">片</span>
          <div>
            <h1 className="text-lg font-bold text-slate-800">katazuku 管理画面</h1>
            <p className="text-xs text-slate-500">合言葉を入れると表示されます(この端末では今回だけ)</p>
          </div>
        </div>
        <input
          className="rounded border border-slate-300 p-2 text-sm"
          type="password"
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          placeholder="合言葉"
        />
        <Button variant="primary" onClick={saveKey} disabled={!keyInput.trim()}>
          表示する
        </Button>
        {error && <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      </div>
    )
  }

  const tracks = data?.tracks ?? []
  const active = tracks.filter((t) => t.outcome !== '不合格' && t.outcome !== '辞退')
  const upcoming = (data?.appointments ?? []).filter((a) => a.atDate && daysLeft(a.atDate) >= 0 && daysLeft(a.atDate) <= 14)
  const withDeadline = active
    .filter((t) => t.deadlineDate && !t.submitted)
    .sort((a, b) => a.deadlineDate!.getTime() - b.deadlineDate!.getTime())
  const waiting = active.filter((t) => /結果待ち|要確認|案内待ち|確定待ち/.test(t.status + t.nextAction))

  const companies = [...new Set(tracks.map((t) => t.company))]
    .map((name) => ({
      name,
      tracks: tracks.filter((t) => t.company === name),
      master: data?.master.find((m) => m.company === name || m.officialName === name),
    }))
    .sort((a, b) => Number(a.tracks.every((t) => t.outcome === '不合格' || t.outcome === '辞退')) - Number(b.tracks.every((t) => t.outcome === '不合格' || t.outcome === '辞退')))

  const TabBtn = ({ k, label }: { k: Tab; label: string }) => (
    <button
      className={`flex-1 rounded-md px-2 py-1.5 text-sm font-semibold ${tab === k ? 'bg-blue-600 text-white' : 'text-slate-500'}`}
      onClick={() => setTab(k)}
    >
      {label}
    </button>
  )

  return (
    <div className="mx-auto max-w-3xl p-3 pb-16">
      <header className="mb-3 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-500 font-bold text-white">片</span>
        <h1 className="font-bold text-slate-800">katazuku</h1>
        <span className="ml-auto text-xs text-slate-400">
          {data?.generatedAt
            ? `DB ${data.generatedAt.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 時点`
            : ''}
        </span>
        <Button size="S" variant="secondary" onClick={() => load()} disabled={loading}>
          {loading ? '読込中…' : '更新'}
        </Button>
      </header>

      <nav className="sticky top-0 z-10 mb-3 flex gap-1 rounded-lg bg-slate-100 p-1">
        <TabBtn k="today" label="きょう" />
        <TabBtn k="tracks" label={`選考 ${active.length}`} />
        <TabBtn k="companies" label="企業" />
        <TabBtn k="log" label="ログ" />
      </nav>

      {error && <p className="mb-3 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {!data && !error && <p className="p-8 text-center text-sm text-slate-400">読み込んでいます…</p>}

      {data && tab === 'today' && (
        <div className="flex flex-col gap-4">
          <section>
            <h2 className="mb-1 text-sm font-bold text-slate-500">予定(面接・締切)</h2>
            {upcoming.length === 0 && <p className="text-sm text-slate-400">14日以内の予定はありません</p>}
            {upcoming.map((a, i) => (
              <div key={i} className="mb-1 flex items-center gap-2 rounded-lg border border-slate-300 bg-white p-2">
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-bold ${daysLeft(a.atDate!) <= 1 ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-500'}`}>
                  {fmtAt(a)}
                </span>
                <span className="text-sm font-bold text-slate-800">{a.company}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
                  {a.title}
                  {a.person && ` / ${a.person}`}
                  {a.location && ` @${a.location}`}
                </span>
                {a.url && (
                  <a className="shrink-0 rounded bg-blue-600 px-2 py-1 text-xs font-bold text-white" href={a.url} target="_blank" rel="noreferrer">
                    開く
                  </a>
                )}
              </div>
            ))}
          </section>
          <section>
            <h2 className="mb-1 text-sm font-bold text-slate-500">締切(トラック)</h2>
            {withDeadline.map((t, i) => (
              <div key={i} className={`mb-1 rounded-lg border border-slate-300 p-2 ${statusClass(t.status, t.outcome)}`}>
                <div className="flex items-center text-sm font-bold text-slate-800">
                  {t.company}
                  {t.position && <span className="ml-1 font-normal text-slate-500">({t.position})</span>}
                  <DeadlineBadge t={t} />
                </div>
                <p className="text-xs text-slate-500">{t.nextAction || t.status}</p>
              </div>
            ))}
          </section>
          <section>
            <h2 className="mb-1 text-sm font-bold text-slate-500">待ち(結果・案内)</h2>
            {waiting.map((t, i) => (
              <p key={i} className="mb-0.5 text-sm text-slate-600">
                <b>{t.company}</b>
                {t.position && <span className="text-slate-400">({t.position})</span>} — {t.status}
              </p>
            ))}
          </section>
        </div>
      )}

      {data && tab === 'tracks' && (
        <div>
          {tracks.map((t, i) => (
            <div key={i} className={`mb-1 rounded-lg border border-slate-300 p-2 ${statusClass(t.status, t.outcome)}`}>
              <div className="flex items-baseline gap-1 text-sm">
                <b className="text-slate-800">{t.company}</b>
                <span className="text-xs text-slate-500">{t.period}{t.position && `・${t.position}`}</span>
                <DeadlineBadge t={t} />
              </div>
              <p className="text-xs text-slate-600">{t.status}</p>
              {t.steps.length > 0 && <p className="text-xs text-slate-400">{t.steps.join(' → ')}</p>}
              {t.nextAction && <p className="text-xs text-blue-700">次: {t.nextAction}</p>}
            </div>
          ))}
        </div>
      )}

      {data && tab === 'companies' && (
        <div>
          {companies.map((c) => (
            <div key={c.name} className="mb-1 rounded-lg border border-slate-300 bg-white">
              <button
                className="flex w-full items-center justify-between p-2 text-left text-sm font-bold text-slate-800"
                onClick={() => setOpenCompany(openCompany === c.name ? null : c.name)}
              >
                <span>
                  {c.name}
                  <span className="ml-1 text-xs font-normal text-slate-400">
                    {c.master?.industry} {c.tracks.length > 1 ? `/ ${c.tracks.length}トラック` : ''}
                  </span>
                </span>
                <span className="text-slate-400">{openCompany === c.name ? '−' : '+'}</span>
              </button>
              {openCompany === c.name && (
                <div className="border-t border-slate-200 p-2 text-xs text-slate-600">
                  {c.master?.officialName && c.master.officialName !== c.name && (
                    <p className="mb-1 text-slate-400">正式名称: {c.master.officialName}</p>
                  )}
                  {c.tracks.map((t, i) => (
                    <p key={i} className="mb-1">
                      <span className="font-semibold">{t.period}{t.position && `・${t.position}`}</span>: {t.status}
                      {t.steps.length > 0 && <span className="text-slate-400"> ({t.steps.join('→')})</span>}
                      {t.memo && <span className="block text-slate-400">{t.memo}</span>}
                    </p>
                  ))}
                  {c.master?.mypageUrl && (
                    <p>
                      <a className="text-blue-700 underline" href={c.master.mypageUrl} target="_blank" rel="noreferrer">
                        マイページを開く
                      </a>
                      {c.master.loginId && <span className="ml-2 text-slate-400">ID: {c.master.loginId}</span>}
                    </p>
                  )}
                  {!c.master?.mypageUrl && c.master?.loginId && <p className="text-slate-400">ID: {c.master.loginId}</p>}
                  {c.master?.memo && <p className="mt-1 text-slate-400">{c.master.memo}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {data && tab === 'log' && (
        <div>
          {data.activities.length === 0 && <p className="text-sm text-slate-400">活動ログはまだありません</p>}
          {data.activities.map((a, i) => (
            <div key={i} className="mb-2 rounded-lg border border-slate-300 bg-white p-2 text-xs">
              <p className="font-bold text-slate-800">
                {a.action}
                <span className="ml-2 font-normal text-slate-400">{a.ts} / {a.by}</span>
              </p>
              {a.why && <p className="text-slate-500">なぜ: {a.why}</p>}
              {a.how && <p className="text-slate-500">どう: {a.how}</p>}
              {a.result && <p className="text-slate-500">結果: {a.result}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
