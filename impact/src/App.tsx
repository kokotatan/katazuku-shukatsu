import { useEffect, useMemo, useState } from 'react'
import type { InboxEmail, PipelineCompany } from './types'
import { computeOutcome, formatDuration, type OutcomeDomain } from './lib/outcome'
import { INBOX_KEY, loadJson, PIPELINE_KEY } from './lib/storage'
import { AppNav } from './components/AppNav'

const toMin = (sec: number) => Math.round(sec / 60)
const fmtMin = (min: number) => formatDuration(min * 60)

/** 手作業 → katazuku後 のダンベル1行 */
function DumbbellRow({ domain, denomSec }: { domain: OutcomeDomain; denomSec: number }) {
  const scale = (s: number) => (denomSec > 0 ? (s / denomSec) * 92 : 0)
  const manualPct = scale(domain.manualSec)
  const autoPct = scale(domain.autoSec)
  return (
    <div className="flex items-center gap-3 py-2.5">
      <span className="w-28 shrink-0 text-sm text-slate-700">{domain.label}</span>
      <div className="relative h-4 flex-1">
        <span
          className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-slate-300"
          style={{ left: `${autoPct}%`, width: `${Math.max(manualPct - autoPct, 0)}%` }}
        />
        <span
          aria-hidden
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-400 ring-2 ring-white"
          style={{ left: `${manualPct}%` }}
        />
        <span
          aria-hidden
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500 ring-2 ring-white"
          style={{ left: `${autoPct}%` }}
        />
      </div>
      <span className="w-32 shrink-0 text-right text-sm text-slate-500 tabular-nums">
        {fmtMin(toMin(domain.manualSec))}
        <span className="mx-1 text-slate-400">→</span>
        {fmtMin(toMin(domain.autoSec))}
      </span>
    </div>
  )
}

export default function App() {
  const [emails, setEmails] = useState<InboxEmail[]>(() => loadJson<InboxEmail>(INBOX_KEY))
  const [companies, setCompanies] = useState<PipelineCompany[]>(() => loadJson<PipelineCompany>(PIPELINE_KEY))

  // 他タブ(Inbox/Status)の変更を開いたまま反映する
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === INBOX_KEY) setEmails(loadJson<InboxEmail>(INBOX_KEY))
      if (e.key === PIPELINE_KEY) setCompanies(loadJson<PipelineCompany>(PIPELINE_KEY))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const o = useMemo(() => computeOutcome(emails, companies), [emails, companies])

  const rows = o.domains.filter((d) => d.count > 0)
  const denomSec = rows.reduce((m, d) => Math.max(m, d.manualSec), 0)
  // 表示はすべて「各領域を分に丸めてから合計」で統一(内訳と合計が必ず一致する)
  const manualMin = o.domains.reduce((n, d) => n + toMin(d.manualSec), 0)
  const autoMin = o.domains.reduce((n, d) => n + toMin(d.autoSec), 0)
  const savedMin = manualMin - autoMin

  const hasData = o.totalEmails > 0

  const effects = [
    {
      title: 'メールに、埋もれない。',
      fact: `届いた ${o.totalEmails} 通を自動で仕分け。宣伝 ${o.promo} 通は自動で脇へよける。`,
      tag: 'Inbox',
    },
    {
      title: '締切を、見落とさない。',
      fact: `本文から締切・日程を ${o.deadlines} 件、自動で抽出して「今日やること」へ載せる。`,
      tag: 'Inbox → Insight',
    },
    {
      title: '次の一手に、迷わない。',
      fact: `要対応の ${o.actions} 件を、具体的な「やること」に変換して並べる。`,
      tag: 'Inbox',
    },
    {
      title: '選考が、一望できる。',
      fact: `${o.activeCompanies} 社の進行を1枚のボードで管理。面接 ${o.interviews}・内定 ${o.offers}。`,
      tag: 'Status',
    },
  ]

  const stats = [
    { value: `${o.totalEmails}`, unit: '通', label: '自動仕分け' },
    { value: `${o.deadlines}`, unit: '件', label: '締切を捕捉' },
    { value: `${o.activeCompanies}`, unit: '社', label: '選考を管理' },
    { value: fmtMin(savedMin), unit: '', label: '手作業を肩代わり' },
  ]

  return (
    <div className="flex min-h-screen">
      <AppNav current="impact" />
      <div className="min-h-screen min-w-0 flex-1 pb-14 md:pb-0">
        <header className="sticky top-0 z-10 border-b border-slate-300 bg-white">
          <div className="flex items-center gap-2.5 px-6 py-3">
            <h1 className="flex items-baseline gap-2.5">
              <span className="text-lg font-bold tracking-tight text-slate-900">効果</span>
              <span className="hidden text-xs font-normal text-slate-500 sm:inline">
                katazuku を使うと、就活はどう変わるか。
              </span>
            </h1>
          </div>
        </header>

        <main className="mx-auto max-w-4xl px-6 py-10">
          {!hasData && (
            <div className="mb-6 rounded-lg border border-slate-300 bg-white px-4 py-3 text-xs text-slate-500">
              数字はこのブラウザに保存された実データ(Inbox / Status)から集計します。データがない環境では 0 と表示されます。
            </div>
          )}

          {/* ヒーロー: 使うと得られる変化(約束) */}
          <p className="text-xs font-bold tracking-[0.15em] text-blue-600 uppercase">katazuku を使うと</p>
          <h2 className="mt-2 text-4xl font-bold leading-tight tracking-tight text-slate-900 sm:text-5xl">
            就活の<span className="text-blue-600">雑務</span>が、手から消える。
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-8 text-slate-500">
            メール、締切、選考、ES、面接準備。散らかりがちな就活を、放っておいても片付いた状態に保ちつづける
            プロダクト群です。あなたは、判断だけをする。
          </p>

          {/* 効果の要約(実数) */}
          <div className="mt-6 flex flex-wrap gap-x-10 gap-y-3 rounded-xl border border-slate-300 bg-white px-6 py-4">
            {stats.map((s) => (
              <div key={s.label}>
                <p className="text-2xl font-bold text-slate-900">
                  {s.value}
                  {s.unit && <span className="ml-0.5 text-sm font-normal text-slate-400">{s.unit}</span>}
                </p>
                <p className="text-xs text-slate-500">{s.label}</p>
              </div>
            ))}
          </div>

          {/* 使うと、こうなる(得られる効果) */}
          <p className="mt-12 mb-4 border-b border-slate-200 pb-2 text-sm font-bold tracking-wide text-slate-700">
            使うと、こうなる
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {effects.map((e) => (
              <div key={e.title} className="rounded-xl border border-slate-300 bg-white p-5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-lg font-bold text-slate-900">{e.title}</h3>
                  <span className="shrink-0 rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-600">
                    {e.tag}
                  </span>
                </div>
                <p className="text-sm leading-7 text-slate-500">{e.fact}</p>
              </div>
            ))}
          </div>

          {/* 同じことを人手でやると(before → after) */}
          <p className="mt-12 mb-4 border-b border-slate-200 pb-2 text-sm font-bold tracking-wide text-slate-700">
            同じことを、人手でやると
          </p>
          <div className="rounded-xl border border-slate-300 bg-white p-5">
            <div className="mb-3 flex items-center gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full bg-slate-400" />
                手作業(推計)
              </span>
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full bg-blue-500" />
                katazuku 後
              </span>
            </div>
            {rows.length > 0 ? (
              rows.map((d) => <DumbbellRow key={d.key} domain={d} denomSec={denomSec} />)
            ) : (
              <p className="py-4 text-sm text-slate-400">データがありません。</p>
            )}
            <p className="mt-3 border-t border-slate-100 pt-3 text-sm text-slate-700">
              合計 <b className="text-slate-900">{fmtMin(manualMin)}</b> ぶんの手作業が、
              <b className="text-blue-600">{fmtMin(autoMin)}</b> の目視確認だけになる。
            </p>
          </div>

          {/* ビジョン */}
          <div className="mt-12 rounded-xl border border-blue-200 bg-blue-50 px-6 py-8 text-center">
            <p className="text-lg font-bold leading-relaxed text-slate-900">
              就活に限らない。人がやらなくていい面倒を、見つけて自動で消す。
            </p>
            <p className="mt-2 text-xs text-slate-500">katazuku は、その最初の一歩。</p>
          </div>

          <p className="mt-6 text-[11px] leading-relaxed text-slate-400">
            試算の前提: メールの仕分け=1通20秒、締切の書き出し=1件40秒、やることの洗い出し=1件30秒の手作業を、
            katazuku 導入後は目視確認だけ(各2〜5秒)に短縮したものとして計算。実測ではなく推定値です。
            数字はこのブラウザの実データ(Inbox / Status)から集計しています。
          </p>
        </main>
      </div>
    </div>
  )
}
