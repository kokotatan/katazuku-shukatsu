import { photoUrl, textValue } from '@katazuku/data'
import { AppNav } from './components/AppNav'
import { DataState } from './components/DataState'
import { useKatazukuData } from './lib/useKatazukuData'

const LABELS: Record<string, string> = {
  name: '氏名', nameKana: 'ふりがな', email: 'メール', phone: '電話番号',
  university: '大学', faculty: '学部', department: '学科', graduationYear: '卒業予定年',
  address: '住所', birthDate: '生年月日', gender: '性別',
  strengths: '強み', weaknesses: '弱み', careerAxis: '就活の軸',
  desiredRole: '希望職種', desiredIndustry: '希望業界', selfPr: '自己PR',
}

export default function App() {
  const { data, error, loading, reload, setKey } = useKatazukuData()
  const profile = data?.profile || {}
  const photoKey = typeof profile.photoKey === 'string' ? profile.photoKey : ''
  const entries = Object.entries(profile)
    .filter(([key, value]) => key !== 'photoKey' && textValue(value).trim())
  const suggestions = data?.profileSuggestions || []

  return (
    <div className="min-h-screen bg-white text-slate-900 md:flex">
      <AppNav current="profile" />
      <main className="app-page min-w-0 flex-1 px-4 py-6 pb-24 md:px-8 md:py-8">
        <header className="mb-6 flex items-center justify-between gap-3">
          <div><h1 className="text-2xl font-bold">自分の情報</h1></div>
          <button type="button" onClick={reload} disabled={loading} className="app-refresh" aria-live="polite">{loading ? '更新中…' : '更新'}</button>
        </header>
        {data && error && <p role="alert" className="mb-4 text-sm text-red-700">更新できませんでした。{error}</p>}
        {!data ? <DataState view="profile" loading={loading} error={error} onSaveKey={setKey} /> : (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
            <section className="app-panel">
              <div className="mb-5 flex items-center gap-4 border-b border-slate-200 pb-5">
                {photoKey ? <img src={photoUrl(photoKey)} alt="証明写真" className="h-20 w-20 rounded-lg border border-slate-300 object-cover" /> : <div aria-hidden className="flex h-20 w-20 items-center justify-center rounded-lg bg-slate-200 text-2xl font-bold text-slate-600">人</div>}
                <div><h2 className="text-lg font-bold">基本情報</h2><p className="mt-1 text-sm text-slate-600">{entries.length}項目</p></div>
              </div>
              <dl className="grid gap-x-6 sm:grid-cols-2">
                {entries.map(([key, value]) => (
                  <div key={key} className="border-b border-slate-200 py-3">
                    <dt className="text-xs font-bold text-slate-500">{LABELS[key] || key}</dt>
                    <dd className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{textValue(value)}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <aside className="app-panel">
              <div className="flex items-center justify-between gap-2"><h2 className="font-bold">面接からの候補</h2><span className="text-xs text-slate-500">{suggestions.length}</span></div>
              <p className="mt-2 text-xs leading-5 text-slate-500">確定情報は自動上書きしません。根拠付き候補として蓄積します。</p>
              <div className="mt-4 space-y-3">
                {suggestions.map((suggestion) => (
                  <article key={String(suggestion.id)} className="border-b border-slate-200 py-3">
                    <p className="text-xs font-semibold text-slate-600">{String(suggestion.field || '')}</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{String(suggestion.value || '')}</p>
                    <p className="mt-2 text-xs text-slate-500">確度 {Math.round(Number(suggestion.confidence || 0) * 100)}%</p>
                  </article>
                ))}
                {suggestions.length === 0 && <p className="text-sm text-slate-500">候補はまだありません。</p>}
              </div>
            </aside>
          </div>
        )}
      </main>
    </div>
  )
}
