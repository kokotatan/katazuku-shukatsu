import { useMemo, useState, type KeyboardEvent } from 'react'
import { FaAngleLeftIcon, FaAngleRightIcon } from 'smarthr-ui'
import { AppNav } from './components/AppNav'
import { DataState } from './components/DataState'
import { useKatazukuData } from './lib/useKatazukuData'
import {
  activityCategories, buildActivityTimeline, dayLabel, entriesOnDay, monthDays, recordTime,
  safeReferenceUrl, shiftDay, shiftMonth, todayInJapan, validDay,
  type ActivityFilter, type TimelineEntry,
} from './lib/activity'

const weekdays = ['日', '月', '火', '水', '木', '金', '土']

function Record({ entry, day }: { entry: TimelineEntry; day: string }) {
  const url = safeReferenceUrl(entry.reference)
  const continued = entry.day && entry.day < day
  const outcome = entry.details.find(item => item.label === '結果' || (entry.category === 'schedule' && item.label === '状態'))
  return <li className="activity-row">
    <div className="activity-time"><time dateTime={entry.day || undefined}>{continued ? '継続' : entry.time || '時刻なし'}</time></div>
    <article className="activity-body">
      <div className="activity-meta"><span className="activity-label">{entry.label}</span>{entry.company && <span>{entry.company}</span>}</div>
      <h3>{entry.title}</h3>
      {entry.summary && <p className="activity-excerpt">{entry.summary}</p>}
      {outcome && <p className="activity-status">{outcome.label}：{outcome.value}</p>}
      {(entry.details.length > 0 || entry.reference || entry.source) && <details className="activity-detail app-disclosure">
        <summary><span>記録の詳細</span></summary>
        <dl>
          {continued && <div><dt>開始日</dt><dd>{dayLabel(entry.day, true)} {entry.time}</dd></div>}
          {entry.details.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}
          {entry.source && <div><dt>記録元</dt><dd>{entry.source}</dd></div>}
          {entry.reference && <div><dt>参照先</dt><dd>{url ? <a href={url} target="_blank" rel="noreferrer">元の記録を開く</a> : entry.reference}</dd></div>}
        </dl>
      </details>}
    </article>
  </li>
}

export default function App() {
  const { data, error, loading, reload, setKey } = useKatazukuData()
  const today = todayInJapan()
  const [selectedDay, setSelectedDay] = useState(() => {
    const date = new URLSearchParams(location.search).get('date') || ''
    return validDay(date) ? date : today
  })
  const [filter, setFilter] = useState<ActivityFilter>('all')
  const timeline = useMemo(() => data ? buildActivityTimeline(data) : { entries: [], undated: [] }, [data])
  const days = useMemo(() => monthDays(selectedDay), [selectedDay])
  const counts = useMemo(() => new Map(days.map(day => [day, entriesOnDay(timeline.entries, day).length])), [days, timeline])
  const dayEntries = entriesOnDay(timeline.entries, selectedDay)
  const visible = filter === 'all' ? dayEntries : dayEntries.filter(entry => entry.category === filter)
  const automatic = filter === 'all' ? dayEntries.filter(entry => entry.category === 'automation') : []
  const mainEntries = filter === 'all' ? visible.filter(entry => entry.category !== 'automation') : visible
  const updated = recordTime(data?.generatedAt)

  const selectDay = (day: string, focus = false, reveal = false) => {
    setSelectedDay(day)
    const url = new URL(location.href)
    url.searchParams.set('date', day)
    history.replaceState(null, '', url)
    if (focus) requestAnimationFrame(() => document.getElementById(`activity-day-${day}`)?.focus())
    if (reveal && matchMedia('(max-width: 1150px)').matches) requestAnimationFrame(() => document.getElementById('activity-day-title')?.scrollIntoView({ block: 'start' }))
  }
  const moveWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>, day: string) => {
    const offset = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>)[event.key]
    if (offset !== undefined) { event.preventDefault(); selectDay(shiftDay(day, offset), true) }
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault(); selectDay(shiftMonth(day, event.key === 'PageUp' ? -1 : 1), true)
    }
  }

  return <div className="min-h-screen bg-white text-slate-900 md:flex">
    <AppNav current="impact" />
    <main className="app-page min-w-0 flex-1 px-4 py-6 pb-24 md:px-8 md:py-8">
      <header className="activity-header">
        <div><h1 className="text-2xl font-bold">活動記録</h1><p>日付を選んで、その日の出来事を振り返る。</p></div>
        <button type="button" onClick={reload} disabled={loading} className="app-refresh" aria-live="polite">{loading ? '更新中…' : '更新'}</button>
      </header>
      {data && error && <p role="alert" className="mb-4 text-sm text-red-700">更新できませんでした。{error}</p>}
      {!data ? <DataState view="impact" loading={loading} error={error} onSaveKey={setKey} /> : <>
        <div className="activity-layout">
          <section className="activity-calendar" aria-labelledby="activity-month">
            <div className="activity-month-nav">
              <h2 id="activity-month">{Number(selectedDay.slice(0, 4))}年{Number(selectedDay.slice(5, 7))}月</h2>
              <div>
                <button type="button" onClick={() => selectDay(shiftMonth(selectedDay, -1))} aria-label="前の月"><FaAngleLeftIcon /></button>
                <button type="button" onClick={() => selectDay(shiftMonth(selectedDay, 1))} aria-label="次の月"><FaAngleRightIcon /></button>
                <button type="button" className="activity-today" onClick={() => selectDay(today, false, true)}>今日</button>
              </div>
            </div>
            <table aria-labelledby="activity-month" className="activity-month-grid">
              <thead><tr>{weekdays.map(day => <th scope="col" key={day}>{day}</th>)}</tr></thead>
              <tbody>{Array.from({ length: days.length / 7 }, (_, week) => <tr key={week}>{days.slice(week * 7, week * 7 + 7).map(day => {
                const count = counts.get(day) || 0
                return <td key={day}><button type="button" id={`activity-day-${day}`}
                  tabIndex={day === selectedDay ? 0 : -1} onKeyDown={event => moveWithKeyboard(event, day)}
                  className={`${day.slice(0, 7) !== selectedDay.slice(0, 7) ? 'activity-other-month' : ''}${day === today ? ' activity-current-day' : ''}`}
                  aria-label={`${dayLabel(day, true)}、${count}件の記録`} aria-pressed={day === selectedDay}
                  aria-current={day === today ? 'date' : undefined} onClick={() => selectDay(day, false, true)}>
                  <span>{Number(day.slice(8))}</span><span className="activity-day-count" aria-hidden="true">{count || ''}</span>
                </button></td>
              })}</tr>)}</tbody>
            </table>
            <p className="activity-calendar-note">日付の下の数字は、同期済みの記録の件数です。</p>
            <details className="activity-coverage app-disclosure">
              <summary><span>表示する記録について</span></summary>
              <p>予定、受信メール、メール対応、会話・作業メモ、面接や提出の記録を表示します。会話は保存された要約・作業記録が対象です。</p>
              <p>過去の記録は同期されている範囲で表示します。記録がない日も、活動がなかったとは限りません。日時は日本時間です。</p>
              {updated && <p>最終更新：{dayLabel(updated.day)} {updated.time}</p>}
            </details>
          </section>
          <section className="activity-day" aria-labelledby="activity-day-title">
            <div className="activity-day-heading"><h2 id="activity-day-title">{dayLabel(selectedDay)}</h2><span aria-live="polite">{dayEntries.length}件</span>
              <button type="button" className="activity-back-calendar" onClick={() => document.getElementById('activity-month')?.scrollIntoView({ block: 'start' })}>日付を選ぶ</button>
            </div>
            <div className="activity-filters" role="group" aria-label="記録の種類">
              {([['all', 'すべて'], ...Object.entries(activityCategories)] as [ActivityFilter, string][]).map(([value, label]) =>
                <button type="button" key={value} onClick={() => setFilter(value)} aria-pressed={filter === value}>{label}</button>)}
            </div>
            {automatic.length > 0 && <details key={selectedDay} className="activity-automatic app-disclosure">
              <summary><span>自動処理の記録</span><span>{automatic.length}件</span></summary>
              <ol className="activity-timeline">{automatic.map(entry => <Record key={entry.id} entry={entry} day={selectedDay} />)}</ol>
            </details>}
            {visible.length > 0 ? <ol className="activity-timeline">{mainEntries.map(entry => <Record key={entry.id} entry={entry} day={selectedDay} />)}</ol>
              : <div className="activity-empty" role="status"><p>{dayEntries.length ? 'この種類の記録はありません。' : 'この日に表示できる記録はありません。'}</p>
                {filter !== 'all' && <button type="button" onClick={() => setFilter('all')}>すべての種類を表示</button>}</div>}
          </section>
        </div>
        {timeline.undated.length > 0 && <details className="activity-undated app-disclosure"><summary><span>日付を確認できない記録（{timeline.undated.length}件）</span></summary>
          <ol className="activity-timeline">{timeline.undated.map(entry => <Record key={entry.id} entry={entry} day="" />)}</ol>
        </details>}
      </>}
    </main>
  </div>
}
