import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import type { InboxEmail, PipelineCompany } from './types'
import { AUTO_SEC, computeOutcome, formatDuration, MANUAL_SEC } from './lib/outcome'
import { computeMetrics } from './lib/metrics'
import { INBOX_KEY, loadJson, PIPELINE_KEY } from './lib/storage'
import { AppNav } from './components/AppNav'

/*
 * 効果ダッシュボード。Inbox/Status の実データ(localStorage・同一オリジン)から集計する。
 * 配色は SmartHR トークン(index.css と同値)。ブルー基調、ノイズ(宣伝/対象外)はグレー。
 */

const C = {
  blue800: '#00477a',
  blue700: '#005a9a',
  blue600: '#0071c1',
  blue500: '#0077c7',
  blue200: '#a0cfee',
  blue100: '#d2e8f7',
  slate900: '#23221e',
  slate500: '#706d65',
  slate400: '#c1bdb7',
  slate300: '#d6d3d0',
  slate200: '#edebe8',
  slate100: '#f5f4f3',
} as const

function niceCeil(v: number): number {
  if (v <= 0) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / p
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return m * p
}

function topRoundRect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h))
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`
}

function Card({ title, hint, className, children }: {
  title: string
  hint?: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={`rounded-xl border border-slate-300 bg-white p-5 ${className ?? ''}`}>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <p className="text-sm font-bold text-slate-700">{title}</p>
        {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
      </div>
      {children}
    </div>
  )
}

type Seg = { label: string; value: number; color: string }

function Donut({ title, centerValue, centerLabel, segments, unit, className }: {
  title: string
  centerValue: string
  centerLabel: string
  segments: Seg[]
  unit: string
  className?: string
}) {
  const total = segments.reduce((n, s) => n + s.value, 0)
  const R = 52
  const SW = 22
  const CIRC = 2 * Math.PI * R
  const gap = 3
  let acc = 0
  return (
    <Card title={title} className={className}>
      <div className="flex items-center gap-5">
        <svg viewBox="0 0 140 140" className="h-32 w-32 shrink-0" role="img" aria-label={title}>
          {/* 背景トラック */}
          <circle cx={70} cy={70} r={R} fill="none" stroke={C.slate100} strokeWidth={SW} />
          <g transform="rotate(-90 70 70)">
            {total > 0 &&
              segments.map((s, i) => {
                const len = (s.value / total) * CIRC
                const dash = Math.max(len - gap, 0.001)
                const circle = (
                  <circle
                    key={i}
                    cx={70}
                    cy={70}
                    r={R}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={SW}
                    strokeDasharray={`${dash} ${CIRC - dash}`}
                    strokeDashoffset={-acc}
                  >
                    <title>{`${s.label}: ${s.value.toLocaleString()}${unit}`}</title>
                  </circle>
                )
                acc += len
                return circle
              })}
          </g>
          <text x={70} y={68} textAnchor="middle" fontSize="18" fontWeight="700" fill={C.slate900}>
            {centerValue}
          </text>
          <text x={70} y={84} textAnchor="middle" fontSize="9" fill={C.slate500}>
            {centerLabel}
          </text>
        </svg>
        <table className="flex-1 text-sm">
          <tbody>
            {segments.map((s) => (
              <tr key={s.label} className="border-b border-slate-100 last:border-0">
                <td className="py-1.5">
                  <span className="flex items-center gap-2">
                    <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                    <span className="text-slate-700">{s.label}</span>
                  </span>
                </td>
                <td className="py-1.5 text-right font-semibold text-slate-900 tabular-nums">
                  {s.value.toLocaleString()}
                </td>
                <td className="py-1.5 pl-3 text-right text-slate-500 tabular-nums">
                  {total > 0 ? ((s.value / total) * 100).toFixed(1) : '0.0'}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function BarChart({ title, hint, labels, values, color, unit, className }: {
  title: string
  hint?: string
  labels: string[]
  values: number[]
  color: string
  unit: string
  className?: string
}) {
  const W = 520
  const H = 190
  const padL = 40
  const padR = 8
  const padT = 10
  const padB = 26
  const max = niceCeil(Math.max(...values, 1))
  const plotW = W - padL - padR
  const plotH = H - padT - padB
  const step = plotW / values.length
  const bw = Math.min(22, step * 0.6)
  const ticks = [0, max / 2, max]
  return (
    <Card title={title} hint={hint} className={className}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={title}>
        {ticks.map((t) => {
          const y = padT + plotH - (t / max) * plotH
          return (
            <g key={t}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke={C.slate200} strokeWidth={1} />
              <text x={padL - 6} y={y + 3} textAnchor="end" fontSize="9" fill={C.slate400}>
                {t >= 1000 ? `${Math.round(t / 1000)}k` : t}
              </text>
            </g>
          )
        })}
        {values.map((v, i) => {
          const h = (v / max) * plotH
          const x = padL + i * step + (step - bw) / 2
          const y = padT + plotH - h
          return (
            <g key={i}>
              <path d={topRoundRect(x, y, bw, h, 4)} fill={color}>
                <title>{`${labels[i]}: ${v.toLocaleString()}${unit}`}</title>
              </path>
              <text x={x + bw / 2} y={H - padB + 14} textAnchor="middle" fontSize="8" fill={C.slate400}>
                {labels[i]}
              </text>
            </g>
          )
        })}
      </svg>
    </Card>
  )
}

type Series = { label: string; color: string; values: number[] }

function StackedBarChart({ title, hint, labels, series, unit, className }: {
  title: string
  hint?: string
  labels: string[]
  series: Series[]
  unit: string
  className?: string
}) {
  const W = 520
  const H = 190
  const padL = 40
  const padR = 8
  const padT = 10
  const padB = 26
  const n = labels.length
  const totals = Array.from({ length: n }, (_, i) => series.reduce((s, ser) => s + ser.values[i], 0))
  const max = niceCeil(Math.max(...totals, 1))
  const plotW = W - padL - padR
  const plotH = H - padT - padB
  const step = plotW / n
  const bw = Math.min(22, step * 0.6)
  const ticks = [0, max / 2, max]
  return (
    <Card title={title} hint={hint} className={className}>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={title}>
        {ticks.map((t) => {
          const y = padT + plotH - (t / max) * plotH
          return (
            <g key={t}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke={C.slate200} strokeWidth={1} />
              <text x={padL - 6} y={y + 3} textAnchor="end" fontSize="9" fill={C.slate400}>
                {t >= 1000 ? `${Math.round(t / 1000)}k` : t}
              </text>
            </g>
          )
        })}
        {Array.from({ length: n }, (_, i) => {
          const x = padL + i * step + (step - bw) / 2
          let yCursor = padT + plotH
          return (
            <g key={i}>
              {series.map((ser, si) => {
                const v = ser.values[i]
                const h = (v / max) * plotH
                yCursor -= h
                const isTop = si === series.length - 1
                return (
                  <path
                    key={ser.label}
                    d={topRoundRect(x, yCursor + 1, bw, Math.max(h - 1, 0), isTop ? 4 : 0)}
                    fill={ser.color}
                  >
                    <title>{`${labels[i]} ${ser.label}: ${v.toLocaleString()}${unit}`}</title>
                  </path>
                )
              })}
              <text x={x + bw / 2} y={H - padB + 14} textAnchor="middle" fontSize="8" fill={C.slate400}>
                {labels[i]}
              </text>
            </g>
          )
        })}
      </svg>
    </Card>
  )
}

function KpiTile({ label, value, unit, delta }: {
  label: string
  value: string
  unit?: string
  delta?: string
}) {
  return (
    <div className="rounded-xl border border-slate-300 bg-white p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
        {value}
        {unit && <span className="ml-0.5 text-sm font-normal text-slate-400">{unit}</span>}
      </p>
      {delta && <p className="mt-0.5 text-xs font-semibold text-blue-600">{delta}</p>}
    </div>
  )
}

const SEL_COLOR: Record<string, string> = {
  selection: C.blue800,
  recruiting: C.blue600,
  activity: C.blue200,
  promo: C.slate400,
  other: C.slate300,
  unknown: C.slate200,
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
  const m = useMemo(() => computeMetrics(emails, companies, new Date()), [emails, companies])

  const labels = m.months.map((b) => b.label)
  // 個人規模では削減は月あたり数十分。単位は「分」で持ち、累計だけ「◯時間◯分」に整形する
  const savedMinutes = m.months.map((b) => b.savedMin)

  const totalEmails = m.months.reduce((n, b) => n + b.emails, 0)
  const totalDeadlines = m.months.reduce((n, b) => n + b.deadlines, 0)
  const totalActions = m.months.reduce((n, b) => n + b.actions, 0)
  const totalPromo = m.months.reduce((n, b) => n + b.promo, 0)

  // 取り戻した時間の内訳(直近12ヶ月の活動別・分)
  const effSeg: Seg[] = [
    { label: 'メールの仕分け', value: Math.round((totalEmails * (MANUAL_SEC.sort - AUTO_SEC.sort)) / 60), color: C.blue800 },
    { label: '締切の抽出', value: Math.round((totalDeadlines * (MANUAL_SEC.deadline - AUTO_SEC.deadline)) / 60), color: C.blue600 },
    { label: 'やること化', value: Math.round((totalActions * (MANUAL_SEC.action - AUTO_SEC.action)) / 60), color: C.blue500 },
  ]
  const effTotal = effSeg.reduce((n, s) => n + s.value, 0)

  const selSeg: Seg[] = m.selection.map((s) => ({ label: s.label, value: s.count, color: SEL_COLOR[s.key] ?? C.slate300 }))
  const selTotal = m.selection.reduce((n, s) => n + s.count, 0)

  const hasData = o.totalEmails > 0

  return (
    <div className="flex min-h-screen">
      <AppNav current="impact" />
      <div className="min-h-screen min-w-0 flex-1 pb-14 md:pb-0">
        <header className="sticky top-0 z-10 border-b border-slate-300 bg-white">
          <div className="flex items-center gap-2.5 px-6 py-3">
            <h1 className="flex items-baseline gap-2.5">
              <span className="text-lg font-bold tracking-tight text-slate-900">効果</span>
              <span className="hidden text-xs font-normal text-slate-500 sm:inline">
                Inbox / Status の実データから集計。
              </span>
            </h1>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-6 py-8">
          {!hasData ? (
            <div className="rounded-xl border border-slate-300 bg-white py-20 text-center">
              <p className="text-lg font-semibold text-slate-700">まだ集計するデータがありません</p>
              <p className="mt-2 text-sm text-slate-400">
                Inbox にメールを取り込むと、ここに効果が表示されます。
              </p>
            </div>
          ) : (
            <>
              {/* アウトカムの要約 */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <KpiTile label="取り戻した時間(直近12ヶ月)" value={formatDuration(effTotal * 60)} />
                <KpiTile label="自動仕分けメール" value={totalEmails.toLocaleString()} unit="通" delta={`うち宣伝 ${totalPromo} 通`} />
                <KpiTile label="拾った締切" value={`${totalDeadlines}`} unit="件" delta={`やること ${totalActions} 件`} />
                <KpiTile label="進行中の選考" value={`${o.activeCompanies}`} unit="社" delta={`面接 ${o.interviews} ・ 内定 ${o.offers}`} />
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <BarChart
                  title="取り戻した時間の推移"
                  hint="分 / 月"
                  labels={labels}
                  values={savedMinutes}
                  color={C.blue500}
                  unit="分"
                  className="lg:col-span-2"
                />

                <Donut
                  title="取り戻した時間の内訳"
                  centerValue={formatDuration(effTotal * 60)}
                  centerLabel="直近12ヶ月"
                  segments={effSeg}
                  unit="分"
                />
                <Donut
                  title="メールの内訳"
                  centerValue={selTotal.toLocaleString()}
                  centerLabel="通"
                  segments={selSeg}
                  unit="通"
                />

                <StackedBarChart
                  title="自動処理した件数の月次内訳"
                  hint="件 / 月"
                  labels={labels}
                  series={[
                    { label: '新規メール', color: C.blue700, values: m.months.map((b) => b.emails) },
                    { label: '締切', color: C.blue500, values: m.months.map((b) => b.deadlines) },
                    { label: 'やること', color: C.blue200, values: m.months.map((b) => b.actions) },
                  ]}
                  unit="件"
                  className="lg:col-span-2"
                />

                <BarChart title="新規メールの自動処理" hint="通 / 月" labels={labels} values={m.months.map((b) => b.emails)} color={C.blue600} unit="通" />
                <BarChart title="締切の捕捉" hint="件 / 月" labels={labels} values={m.months.map((b) => b.deadlines)} color={C.blue500} unit="件" />
                <BarChart title="弾いた宣伝" hint="通 / 月" labels={labels} values={m.months.map((b) => b.promo)} color={C.slate400} unit="通" />
                <BarChart title="片付けたタスク" hint="件 / 月" labels={labels} values={m.months.map((b) => b.done)} color={C.blue700} unit="件" />
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
