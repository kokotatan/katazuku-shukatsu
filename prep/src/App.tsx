import { useEffect, useState } from 'react'
import { formatDate } from '@katazuku/data'
import { AppNav } from './components/AppNav'
import { DataState } from './components/DataState'
import { useKatazukuData } from './lib/useKatazukuData'

const LABELS: Record<string,string> = { business:'事業',customers:'顧客',technology:'技術',researchOrg:'研究開発',fdeRole:'技術職の役割',culture:'社風',risks:'課題・リスク',interviewAngles:'面接で深めたいこと',competitiveLandscape:'競合との違い',hitachiPositioning:'事業の位置づけ',futureCompetitionThesis:'今後の競争環境',akariManufacturingStrategy:'製造業への展開',primaryObservation:'調査で分かったこと',financials:'業績',marketShare:'市場シェア',mission:'使命',vision:'目指す姿',values:'価値観',premise:'調査の前提',technology_firmLevel:'全社の技術戦略',selectionProcess:'選考の流れ',interviewer:'面接官',products:'製品・サービス',competition:'競合',recentNews:'最近の動き',recruiting:'採用情報',questionsToAsk:'聞きたいこと',news:'最近の動き',fit:'自分との接点' }
const normalized = (value: string) => value.normalize('NFKC').toLocaleLowerCase('ja-JP')
const DETAIL_LABELS: Record<string,string> = { asOf:'確認時点',hitachiPharmaPlatform:'医薬分野の基盤',status:'状況',scope:'対象範囲',likelyStrength:'強みの仮説',hitachiAiOrchestration:'AI連携の基盤',caddiPositioning:'事業の位置づけ',openQuestions:'確認したいこと',target:'対象',hypotheses:'仮説',verifiedFacts:'確認できた事実',supportedInference:'根拠のある見立て',notYetConfirmed:'未確認の点',implicationForCaddi:'事業への示唆',items:'調査項目',claim:'内容',url:'資料',role:'役割',stack:'技術構成',problemsToSolve:'解決する課題',unknown:'未確認の点',market:'市場',advantagesHypothesis:'優位性の仮説',caution:'注意点',risk:'リスク',basisUrl:'根拠資料',verify:'要確認',date:'日付',openings:'募集職種',title:'題名',work:'仕事内容',entryUrl:'応募先',deadline:'締切',portal:'手続き先',notes:'補足',confirmed:'確認済み',whyThisCompany:'この企業を選ぶ理由',angle:'切り口',whatToDo:'取り組むこと',likelyEvaluationAxes:'評価される点の仮説',axis:'観点',show:'伝えること',answerStructure:'回答の組み立て',priority:'優先度',avoid:'避けたいこと',point:'要点',source:'出典' }
function FactValue({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === '') return null
  if (Array.isArray(value)) return <ul className="list-disc space-y-2 pl-5 marker:text-slate-500">{value.map((item,index)=><li key={index}><FactValue value={item} /></li>)}</ul>
  if (typeof value === 'object') return <dl className="space-y-4">{Object.entries(value as Record<string,unknown>).map(([key,child])=><div key={key}><dt className="text-sm font-semibold text-slate-600">{DETAIL_LABELS[key] || LABELS[key] || (/^[\x00-\x7F]+$/.test(key)?'補足':key)}</dt><dd className="mt-1"><FactValue value={child} /></dd></div>)}</dl>
  const url = typeof value === 'string' && value.startsWith('https://') ? externalUrl(value) : undefined
  return url ? <a href={url} target="_blank" rel="noreferrer" className="text-blue-600 underline">資料を開く</a> : <p className="whitespace-pre-wrap break-words">{typeof value === 'boolean' ? (value?'はい':'いいえ') : String(value)}</p>
}
function externalUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined
  try { const url = new URL(value, location.origin); return url.protocol === 'https:' || (url.origin === location.origin && value.startsWith('/')) ? url.href : undefined } catch { return undefined }
}
function CompanyLogo({ name, src }: { name: string; src?: string }) {
  const [failed,setFailed] = useState(false)
  return src && !failed ? <img src={src} alt={`${name}のロゴ`} width={56} height={56} referrerPolicy="no-referrer" onError={()=>setFailed(true)} className="h-14 w-14 shrink-0 rounded bg-slate-50 p-1 object-contain" /> : <span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded bg-slate-100 text-lg font-bold text-slate-600">{name.slice(0,2)}</span>
}

export default function App() {
  const { data,error,loading,reload,setKey } = useKatazukuData()
  const [query,setQuery] = useState('')
  const [selected,setSelected] = useState(()=>new URLSearchParams(location.search).get('company') || '')
  const companies = Array.from(new Set([...(data?.dossiers||[]).map(item=>item.company),...(data?.selections||[]).map(item=>item.company)])).filter(Boolean)
  const company = companies.includes(selected) ? selected : companies[0] || ''
  const matches = companies.filter(name=>normalized(name).includes(normalized(query.trim())))
  const dossier = data?.dossiers.find(item=>item.company===company)
  const preparations = (data?.meetingPreparations || []).filter(item=>item.company===company)
  const interviews = (data?.interviews||[]).filter(item=>item.company===company).sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt))
  const people = (data?.people||[]).filter(item=>item.company===company || item.officialCompany===company)
  const appointments = (data?.appointments||[]).filter(item=>item.company===company && item.status==='予定' && new Date(item.at).getTime() >= Date.now()-3600000).sort((a,b)=>a.at.localeCompare(b.at))
  useEffect(()=>{ const onPop=()=>setSelected(new URLSearchParams(location.search).get('company')||''); window.addEventListener('popstate',onPop); return()=>window.removeEventListener('popstate',onPop) },[])
  const choose=(name:string)=>{ setSelected(name); const url=new URL(location.href); url.searchParams.set('company',name); history.pushState(null,'',url) }
  const logoFor=(name:string)=>externalUrl(data?.dossiers.find(item=>item.company===name)?.facts.logoUrl)

  return <div className="min-h-screen bg-white text-slate-900 md:flex"><AppNav current="prep" /><main className="app-page min-w-0 flex-1 px-4 py-6 pb-24 md:px-8 md:py-8">
    <header className="mb-6 flex items-center justify-between gap-3"><h1 className="text-2xl font-bold">企業研究</h1><button type="button" onClick={reload} disabled={loading} className="app-refresh" aria-live="polite">{loading ? '更新中…' : '更新'}</button></header>
    {data && error && <p role="alert" className="mb-4 text-sm text-red-700">更新できませんでした。{error}</p>}
    {!data ? <DataState view="prep" loading={loading} error={error} onSaveKey={setKey} /> : <>
      <div className="grid items-start gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
        <section aria-label="企業を選ぶ" className="min-w-0 xl:sticky xl:top-8 xl:self-start">
          <label className="sr-only" htmlFor="research-search">企業名を検索</label><input id="research-search" type="search" autoComplete="off" spellCheck={false} value={query} onChange={event=>setQuery(event.target.value)} placeholder="企業名を検索" className="min-h-12 w-full rounded-lg border border-slate-300 bg-white px-4 text-base" />
          <label className="sr-only" htmlFor="research-company">企業を選ぶ</label><select id="research-company" value={matches.includes(company)?company:''} onChange={event=>choose(event.target.value)} className="mt-3 min-h-12 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-base xl:hidden"><option value="" disabled>企業を選ぶ</option>{matches.map(name=><option key={name} value={name}>{name}</option>)}</select>
          {!matches.length && <p className="mt-3 text-sm text-slate-600">{companies.length?'見つかりませんでした。':'企業の記録はまだありません。'}</p>}
          <div className="mt-3 hidden max-h-[calc(100dvh-200px)] overflow-y-auto border-t border-slate-300 xl:block">{matches.map(name=><button key={name} type="button" aria-pressed={name===company} onClick={()=>choose(name)} className={`flex w-full items-center gap-3 border-b border-slate-200 border-l-2 p-3 text-left text-sm last:border-b-0 ${name===company?'border-l-blue-500 bg-slate-100 font-semibold text-slate-900':'border-l-transparent hover:bg-slate-50'}`}><CompanyLogo key={`${name}-${logoFor(name)}`} name={name} src={logoFor(name)} /><span className="min-w-0 break-words">{name}</span></button>)}</div>
        </section>
        {company && <article className="min-w-0 border-t border-slate-300 pt-6 xl:border-l xl:border-t-0 xl:border-slate-200 xl:pl-8 xl:pt-0">
          <header className="flex items-center gap-4"><CompanyLogo key={`${company}-${logoFor(company)}`} name={company} src={logoFor(company)} /><div className="min-w-0"><h2 className="break-words text-xl font-bold">{company}</h2>{dossier?.researchedAt && <p className="mt-1 text-xs text-slate-500">調査 {formatDate(dossier.researchedAt,false)}</p>}</div></header>
          {appointments[0] && <a href="/insight/" className="mt-5 block border-l-2 border-blue-500 py-1 pl-4 text-sm text-blue-700"><span className="font-bold">次の予定</span><time className="ml-3">{formatDate(appointments[0].at)}</time><span className="mt-1 block">{appointments[0].title}</span></a>}
          {preparations.map(item=><section key={item.appointmentId} className="mt-6 border-t border-slate-200 pt-5">
            <h3 className="font-bold">{formatDate(item.at)}の面談準備</h3>
            {item.status==='pending' ? <p className="mt-3 text-sm text-slate-600">準備中です。{item.reasons.join('。')}</p> : <>
              <p className="mt-3 max-w-prose whitespace-pre-wrap leading-8">{item.summary}</p>
              <details className="app-disclosure mt-3"><summary>相手・前回まで・想定問答を読む</summary><div className="space-y-5 py-4 text-base leading-8">
                <section><h4 className="font-semibold">面談相手</h4><p className="whitespace-pre-wrap">{item.counterpartResearch}</p></section>
                <section><h4 className="font-semibold">前回まで</h4><p className="whitespace-pre-wrap">{item.priorContext}</p></section>
                <section><h4 className="font-semibold">聞きたいこと</h4><ul className="list-disc pl-5">{item.questionsToAsk?.map((q,i)=><li key={i}>{q}</li>)}</ul></section>
                <section><h4 className="font-semibold">想定問答</h4>{item.anticipatedQuestions?.map((q,i)=><div key={i} className="mt-3"><p className="font-medium">{q.question}</p><p>{q.answerOutline}</p></div>)}</section>
                {!!item.unknowns?.length && <section><h4 className="font-semibold">確認が必要なこと</h4><ul className="list-disc pl-5">{item.unknowns.map((q,i)=><li key={i}>{q}</li>)}</ul></section>}
                <ul className="space-y-2 text-sm">{item.sources?.map((s,i)=><li key={i}><a href={externalUrl(s.url)} target="_blank" rel="noreferrer" className="text-blue-600 underline">{s.title}</a></li>)}</ul>
              </div></details>
            </>}
          </section>)}
          {dossier ? <>
            {dossier.summary && <p className="mt-6 max-w-prose whitespace-pre-wrap break-words text-base leading-8">{dossier.summary}</p>}
            <div className="mt-6 space-y-7">{Object.entries(dossier.facts).filter(([key])=>!['logoUrl','website','logoSource'].includes(key)).map(([key,value])=><section key={key} className="border-t border-slate-200 pt-5"><h3 className="font-bold">{LABELS[key] || (/^[\x00-\x7F]+$/.test(key)?'補足情報':key)}</h3><div className="mt-3 max-w-prose text-base leading-8"><FactValue value={value} /></div></section>)}</div>
            <details className="app-disclosure mt-6 border-t border-slate-200 pt-2"><summary className="text-sm font-semibold"><span>出典 <span className="ml-2 font-normal tabular-nums text-slate-500">{dossier.sources.length}件</span></span></summary><ul className="space-y-3 pb-4 pt-2">{dossier.sources.map((source,index)=><li key={index} className="break-words text-sm leading-7">{externalUrl(source.url)?<a href={externalUrl(source.url)} target="_blank" rel="noreferrer" className="text-blue-600 underline underline-offset-4">{source.title||'資料を開く'}</a>:source.title}</li>)}</ul></details>
          </> : <p className="mt-6 text-sm text-slate-500">この企業の研究資料はまだありません。</p>}
          {people.length>0 && <section className="mt-6 border-t border-slate-200 pt-5"><h3 className="font-bold">会った人</h3><ul className="mt-3 divide-y divide-slate-200">{people.map(person=><li key={person.id}><a href={`/people/?person=${person.id}`} className="flex min-h-14 flex-wrap items-center gap-x-3 py-3 text-sm"><span className="font-semibold text-blue-600">{person.name}</span><span className="text-slate-600">{person.role}</span></a></li>)}</ul></section>}
          <section className="mt-6 border-t border-slate-200 pt-5"><h3 className="font-bold">面接の記録</h3>{interviews.map(interview=><details key={interview.id} className="app-disclosure border-b border-slate-200 py-2"><summary className="text-sm leading-7"><span><time className="mr-3 text-slate-500">{formatDate(interview.occurredAt,false)}</time>{interview.title}</span></summary><p className="mt-3 pb-3 whitespace-pre-wrap break-words text-base leading-8">{interview.summary}</p></details>)}{!interviews.length && <p className="mt-3 text-sm text-slate-500">面接の記録はまだありません。</p>}</section>
        </article>}
      </div>
    </>}
  </main></div>
}
