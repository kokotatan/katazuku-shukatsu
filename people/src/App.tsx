import { useEffect, useRef, useState } from 'react'
import { formatDate, photoUrl, type Person } from '@katazuku/data'
import { AppNav } from './components/AppNav'
import { DataState } from './components/DataState'
import { useKatazukuData } from './lib/useKatazukuData'

function Face({ person, large = false }: { person: Person; large?: boolean }) {
  const [failed, setFailed] = useState(false)
  const size = large ? 'h-24 w-24 text-3xl' : 'h-14 w-14 text-xl'
  return person.photoKey && !failed
    ? <img src={photoUrl(person.photoKey)} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className={`${size} shrink-0 rounded bg-slate-50 object-cover object-top`} />
    : <span aria-label="写真未登録" className={`${size} flex shrink-0 items-center justify-center rounded-lg bg-slate-100 font-semibold text-slate-500`}>{person.name.slice(0, 1)}</span>
}

const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase('ja-JP')
export default function App() {
  const { data, error, loading, reload, setKey } = useKatazukuData()
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(() => Number(new URLSearchParams(location.search).get('person')) || 0)
  const detailHeading = useRef<HTMLHeadingElement>(null)
  const listHeading = useRef<HTMLInputElement>(null)
  const listScroll = useRef(0)
  const people = data?.people || []
  const notes = data?.personNotes || []
  const person = people.find(item => item.id === selectedId)
  const personNotes = notes.filter(note => note.personId === selectedId).sort((a,b) => b.at.localeCompare(a.at) || b.id-a.id)
  const matches = people.filter(item => normalize([item.name,item.company,item.role,item.howMet,...notes.filter(n=>n.personId===item.id).map(n=>n.note)].join(' ')).includes(normalize(query.trim())))

  useEffect(() => {
    const onPop = () => {
      const id = Number(new URLSearchParams(location.search).get('person')) || 0
      setSelectedId(id)
      if (!id) requestAnimationFrame(() => { listHeading.current?.focus({ preventScroll: true }); window.scrollTo(0,listScroll.current) })
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  useEffect(() => {
    if (person) detailHeading.current?.focus({ preventScroll: true })
  }, [person?.id])
  const selectPerson = (id: number) => {
    if (selectedId === id) return
    listScroll.current = window.scrollY
    const url = new URL(location.href)
    url.searchParams.set('person', String(id))
    history.pushState({ katazukuPersonView: true },'',url)
    setSelectedId(id)
    if (window.matchMedia('(max-width: 1023px)').matches) window.scrollTo(0,0)
  }
  const backToList = () => {
    const url = new URL(location.href)
    url.searchParams.delete('person')
    if (history.state?.katazukuPersonView) history.back()
    else history.replaceState(null,'',url)
    setSelectedId(0)
    requestAnimationFrame(() => { listHeading.current?.focus({ preventScroll: true }); window.scrollTo(0,listScroll.current) })
  }

  return <div className="min-h-screen bg-white text-slate-900 md:flex">
    <AppNav current="people" />
    <main className="app-page min-w-0 flex-1 px-4 py-6 pb-24 md:px-8 md:py-8">
      <header className="mb-6 flex items-center justify-between gap-3"><h1 className="text-2xl font-bold">人</h1><button type="button" onClick={reload} disabled={loading} className="app-refresh" aria-live="polite">{loading ? '更新中…' : '更新'}</button></header>
      {data && error && <p role="alert" className="mb-4 text-sm text-red-700">更新できませんでした。{error}</p>}
      {!data ? <DataState view="people" loading={loading} error={error} onSaveKey={setKey} /> : <>
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.2fr)]">
          <section className={`lg:sticky lg:top-8 lg:self-start ${person ? 'hidden lg:block' : ''}`} aria-label="人物一覧">
            <label className="sr-only" htmlFor="people-search">名前・会社・話したことを検索</label><input ref={listHeading} id="people-search" type="search" autoComplete="off" spellCheck={false} value={query} onChange={event=>setQuery(event.target.value)} placeholder="名前・会社・話したこと" className="min-h-12 w-full rounded-lg border border-slate-300 bg-white px-4 text-base" />
            <p aria-live="polite" aria-atomic="true" className="my-3 text-sm text-slate-500">{matches.length}人</p>
            <div className="border-t border-slate-300 lg:max-h-[calc(100dvh-190px)] lg:overflow-y-auto">
              {matches.map(item => {
                const latest = notes.filter(note=>note.personId===item.id).sort((a,b)=>b.at.localeCompare(a.at)||b.id-a.id)[0]
                return <button key={item.id} type="button" aria-pressed={item.id === selectedId} onClick={()=>selectPerson(item.id)} className={`flex w-full gap-3 border-l-2 border-b border-slate-200 p-4 text-left last:border-b-0 ${item.id===selectedId ? 'border-l-blue-500 bg-slate-100' : 'border-l-transparent hover:bg-slate-50 active:bg-slate-100'}`}>
                  <Face key={`${item.id}-${item.photoKey}`} person={item} /><span className="min-w-0 flex-1"><span className="block break-words font-bold leading-6">{item.name}</span><span className="mt-0.5 block break-words text-sm text-slate-600">{[item.company,item.role].filter(Boolean).join(' / ')}</span><span className="mt-2 block line-clamp-2 text-sm leading-6 text-slate-600">{latest?.note || item.howMet || '接点の記録はまだありません'}</span></span>
                </button>
              })}
              {!matches.length && <p className="p-6 text-sm text-slate-600">{people.length ? '見つかりませんでした。検索する言葉を変えてください。' : '人の記録はまだありません。'}</p>}
            </div>
          </section>
          {person ? <section aria-label="人物詳細" className="min-w-0 lg:border-l lg:border-slate-200 lg:pl-8">
            <button type="button" onClick={backToList} className="mb-4 min-h-11 text-sm font-semibold text-blue-600 lg:hidden">一覧に戻る</button>
            <div className="flex items-start gap-4"><Face key={`${person.id}-${person.photoKey}`} person={person} large /><div className="min-w-0"><h2 ref={detailHeading} tabIndex={-1} className="text-xl font-bold">{person.name}</h2><a href={`/prep/?company=${encodeURIComponent(person.officialCompany || person.company)}`} className="mt-2 block break-words text-sm text-blue-600">{person.company}</a><p className="mt-1 text-sm text-slate-600">{person.role}</p>{person.category && <p className="mt-2 text-xs text-slate-500">{person.category}</p>}</div></div>
            <section className="mt-6 border-t border-slate-200 pt-5"><h3 className="font-bold">会った場面</h3>{person.metAt && <p className="mt-2 text-sm text-slate-500">{formatDate(person.metAt,false)}</p>}<p className="mt-2 whitespace-pre-wrap break-words text-base leading-7">{person.howMet || '接点の記録はまだありません。'}</p></section>
            <section className="mt-6 border-t border-slate-200 pt-5"><h3 className="font-bold">話したこと</h3><ol className="mt-4 space-y-6">{personNotes.map(note=><li key={note.id} className="border-l border-slate-200 pl-4">{note.at && <time className="text-sm text-slate-500">{formatDate(note.at,false)}</time>}<p className="mt-2 whitespace-pre-wrap break-words text-base leading-7">{note.note}</p></li>)}</ol>{!personNotes.length && <p className="mt-3 text-sm text-slate-500">会話の記録はまだありません。</p>}</section>
            {person.followUp && <section className="mt-6 border-t border-slate-200 pt-5"><h3 className="font-bold">次に話したいこと</h3><p className="mt-2 whitespace-pre-wrap break-words text-base leading-7">{person.followUp}</p></section>}
          </section> : <p className="hidden py-20 text-center text-sm text-slate-500 lg:block">人を選ぶと、接点と会話を確認できます。</p>}
        </div>
      </>}
    </main>
  </div>
}
