import { formatDate, photoUrl } from '@katazuku/data'
import { AppNav } from './components/AppNav'
import { DataState } from './components/DataState'
import { useKatazukuData } from './lib/useKatazukuData'

export default function App() {
  const { data, error, loading, reload, setKey } = useKatazukuData()
  const people = data?.people || []
  const notes = data?.personNotes || []

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 md:flex">
      <AppNav current="people" />
      <main className="min-w-0 flex-1 px-4 py-6 pb-24 md:px-8 md:py-8">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div><p className="text-xs font-bold tracking-wide text-blue-700">PEOPLE</p><h1 className="mt-1 text-2xl font-bold">人</h1><p className="mt-1 text-sm text-slate-600">面接官・社員・OBOGを、出会った根拠と追記専用メモで管理します。</p></div>
          <button type="button" onClick={reload} className="rounded-md border border-slate-400 bg-white px-3 py-2 text-sm font-bold hover:bg-slate-100">再読込</button>
        </header>
        {!data ? <DataState loading={loading} error={error} onSaveKey={setKey} /> : (
          <>
            <div className="mb-5 rounded-xl border border-slate-300 bg-white p-4"><span className="text-sm text-slate-600">登録人物</span><strong className="ml-3 text-2xl">{people.length}</strong></div>
            <section className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3" aria-label="人物一覧">
              {people.map((person) => {
                const personNotes = notes.filter((note) => note.personId === person.id)
                return (
                  <article key={person.id} className="rounded-xl border border-slate-300 bg-white p-5 shadow-sm">
                    <div className="flex gap-4">
                      {person.photoKey ? <img src={photoUrl(person.photoKey)} alt={`${person.name}の顔写真`} className="h-16 w-16 shrink-0 rounded-full border border-slate-300 object-cover" /> : <div aria-hidden className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xl font-bold text-blue-800">{person.name.slice(0, 1)}</div>}
                      <div className="min-w-0">
                        <div className="flex flex-wrap gap-2"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">{person.category || '関係者'}</span></div>
                        <h2 className="mt-1 text-lg font-bold">{person.name}</h2>
                        <p className="text-sm text-slate-600">{[person.company, person.role].filter(Boolean).join(' / ') || '所属未設定'}</p>
                      </div>
                    </div>
                    <dl className="mt-4 grid gap-2 border-t border-slate-200 pt-4 text-sm">
                      <div><dt className="inline text-slate-500">出会い: </dt><dd className="inline">{person.howMet || '未設定'}</dd></div>
                      <div><dt className="inline text-slate-500">会った日: </dt><dd className="inline">{person.metAt ? formatDate(person.metAt, false) : '未設定'}</dd></div>
                      <div><dt className="inline text-slate-500">フォロー: </dt><dd className="inline">{person.followUp || '未設定'}</dd></div>
                    </dl>
                    {personNotes.length > 0 && <div className="mt-4 space-y-2 rounded-lg bg-slate-50 p-3">{personNotes.slice(0, 3).map((note) => <p key={note.id} className="text-sm leading-6">{note.note}</p>)}</div>}
                  </article>
                )
              })}
            </section>
          </>
        )}
      </main>
    </div>
  )
}
