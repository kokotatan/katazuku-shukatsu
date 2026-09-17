import { type ReactNode } from 'react'


type View = 'board' | 'impact' | 'inbox' | 'status' | 'profile' | 'people' | 'prep' | 'insight'

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
export function LayoutOutline({ view }: { view: View }) {
  if (view === 'impact') return <>
    <Metrics labels={['管理中の選考', '進行中', '合格・内定', '自動処理の記録']} />
    <div className="access-columns"><Section title="記録の種類"><Rows /></Section><Section title="選考の結果"><Rows /></Section></div>
    <Section title="活動記録"><Rows /></Section>
  </>
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
