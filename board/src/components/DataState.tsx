import { useState, type FormEvent, type ReactNode } from 'react'
import { FaLockIcon } from 'smarthr-ui'

type View = 'impact' | 'inbox' | 'status' | 'profile' | 'people' | 'prep' | 'insight'

function Line({ short = false }: { short?: boolean }) {
  return <span className={`access-line${short ? ' access-line-short' : ''}`} />
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <div className="access-section"><h3>{title}</h3>{children}</div>
}

function Rows({ people = false }: { people?: boolean }) {
  return <>{[0, 1, 2].map(row => <div className="access-row" key={row}>
    {people ? <span className="access-avatar" /> : <Line short />}
    <div className="access-row-body"><Line /><Line short /></div>
  </div>)}</>
}

function Metrics({ labels }: { labels: string[] }) {
  return <div className="access-metrics">{labels.map(label => <div key={label}><p>{label}</p><span className="access-value" /></div>)}</div>
}

// データを作らず、見出しと配置だけを示す。本文・件数・日時・グラフ値は持たせない。
function Layout({ view }: { view: View }) {
  if (view === 'impact') return <div className="access-calendar-layout">
    <Section title="カレンダー"><Line short /><div className="access-calendar-grid">
      {['日', '月', '火', '水', '木', '金', '土'].map(day => <span key={day}>{day}</span>)}
      {Array.from({ length: 42 }, (_, index) => <i key={index}><span /></i>)}
    </div></Section>
    <Section title="その日の記録"><div className="access-tabs"><span>すべて</span><span>メール</span><span>会話・作業</span></div><Rows /><Rows /></Section>
  </div>
  if (view === 'status') return <>
    <Metrics labels={['すべての選考', '進行中', '合格・内定', '終了']} />
    <div className="access-columns"><Section title="選考状況"><Rows /></Section><Section title="次にすること"><Rows /></Section></div>
  </>
  if (view === 'inbox') return <>
    <div className="access-tabs"><span>すべて</span><span>要対応</span></div>
    {[0, 1, 2].map(row => <div className="access-mail" key={row}><Line short /><Line /><Line /><Line short /></div>)}
  </>
  if (view === 'people' || view === 'prep') return <div className="access-split">
    <div><div className="access-search">{view === 'people' ? '名前・会社・話したことを検索' : '企業名を検索'}</div><Rows people={view === 'people'} /></div>
    <div><div className="access-detail-title"><Line /></div>{(view === 'people' ? ['会った場面', '話したこと', '次に話したいこと'] : ['事業', '顧客', '技術', '聞きたいこと']).map(title => <Section key={title} title={title}><Line /><Line short /></Section>)}</div>
  </div>
  if (view === 'profile') return <div className="access-columns">
    <Section title="基本情報"><div className="access-row"><span className="access-avatar access-portrait" /><div className="access-row-body"><Line /><Line short /></div></div><div className="access-fields">{['氏名', '大学', '希望職種', '自己PR'].map(label => <div key={label}><p>{label}</p><Line /></div>)}</div></Section>
    <Section title="面接からの候補"><Rows /></Section>
  </div>
  return <>{['予定', '今日〜あさって', '待ち（結果・案内）'].map(title => <Section key={title} title={title}><Rows /></Section>)}</>
}

/** 共通の認証前画面。8アプリの同名ファイルをコピー同期する。 */
export function DataState({ view, loading, error, onSaveKey }: {
  view: View
  loading: boolean
  error: string
  onSaveKey: (key: string) => void
}) {
  const [key, setKey] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (key.trim() && !loading) onSaveKey(key)
  }
  return <section className="access-state" aria-label="合言葉で開く">
    <div className="access-layout" aria-hidden="true" inert><Layout view={view} /></div>
    <div className="access-entry">
      <form onSubmit={submit} className="access-form" aria-labelledby="access-title" aria-busy={loading}>
        <span className="access-lock" aria-hidden="true"><FaLockIcon /></span>
        <h2 id="access-title">合言葉を入力</h2>
        <p id="access-description">合言葉を入力すると、内容を表示します。</p>
        <label className="sr-only" htmlFor="katazuku-read-key">閲覧用の合言葉</label>
        <input id="katazuku-read-key" type="password" autoComplete="current-password" value={key} onChange={event => setKey(event.target.value)} aria-describedby={error ? 'access-description access-error' : 'access-description'} aria-invalid={error ? true : undefined} placeholder="合言葉" />
        {error && <p id="access-error" role="alert" className="access-error">{error}</p>}
        <button type="submit" disabled={loading || !key.trim()}>{loading ? '読み込み中…' : '開く'}</button>
        {loading && <p role="status" className="sr-only">データを読み込んでいます。</p>}
      </form>
    </div>
  </section>
}
