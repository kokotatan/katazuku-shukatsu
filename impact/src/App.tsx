import type { ReactNode } from 'react'
import { AppNav } from './components/AppNav'

/*
 * 効果ダッシュボード。SaaSアナリティクス風のBIレイアウト。
 * 配色は SmartHR トークン(index.css と同値)。ブルーを主役に、締切系だけ DANGER の赤。
 * 値は現状ハードコード(将来 Inbox/Status の実データ時系列に差し替え)。
 */

const C = {
  blue800: '#00477a',
  blue700: '#005a9a',
  blue600: '#0071c1',
  blue500: '#0077c7',
  blue200: '#a0cfee',
  blue100: '#d2e8f7',
  blue50: '#e9f4fb',
  slate900: '#23221e',
  slate500: '#706d65',
  slate400: '#c1bdb7',
  slate300: '#d6d3d0',
  slate200: '#edebe8',
  slate100: '#f5f4f3',
  red500: '#e01e5a',
  red200: '#f4b7cc',
} as const

const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

/** きりのいい上限に丸める(軸目盛り用) */
function niceCeil(v: number): number {
  if (v <= 0) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / p
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return m * p
}

/** 上辺だけ角丸の矩形パス(棒の data-end。ベースは直角) */
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
          <g transform="rotate(-90 70 70)">
            {segments.map((s, i) => {
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
                  {((s.value / total) * 100).toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function BarChart({ title, hint, values, color, unit, className }: {
  title: string
  hint?: string
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
                <title>{`${MONTHS[i]}: ${v.toLocaleString()}${unit}`}</title>
              </path>
              <text x={x + bw / 2} y={H - padB + 14} textAnchor="middle" fontSize="8" fill={C.slate400}>
                {MONTHS[i]}
              </text>
            </g>
          )
        })}
      </svg>
    </Card>
  )
}

type Series = { label: string; color: string; values: number[] }

function StackedBarChart({ title, hint, series, unit, className }: {
  title: string
  hint?: string
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
  const n = series[0].values.length
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
                    <title>{`${MONTHS[i]} ${ser.label}: ${v.toLocaleString()}${unit}`}</title>
                  </path>
                )
              })}
              <text x={x + bw / 2} y={H - padB + 14} textAnchor="middle" fontSize="8" fill={C.slate400}>
                {MONTHS[i]}
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

// ---- 値(現状ハードコード) ----
const savedHours = [2, 3, 4, 6, 5, 7, 9, 11, 12, 14, 15, 11]
const newMail = [40, 55, 70, 95, 80, 120, 160, 180, 210, 240, 260, 190]
const deadlineCaught = [8, 12, 16, 22, 18, 28, 36, 42, 50, 58, 64, 44]
const delayPrevented = [1, 2, 2, 3, 2, 4, 5, 6, 7, 8, 9, 6]
const missAvoided = [2, 3, 3, 5, 4, 6, 8, 9, 10, 12, 13, 9]

const stackSeries: Series[] = [
  { label: '新規メール', color: C.blue700, values: newMail },
  { label: '締切対応', color: C.blue500, values: deadlineCaught },
  { label: '選考更新', color: C.blue200, values: [2, 3, 3, 4, 3, 5, 6, 6, 7, 8, 8, 6] },
]

const effectSeg: Seg[] = [
  { label: 'メールの仕分け', value: 44, color: C.blue800 },
  { label: '締切の抽出', value: 25, color: C.blue600 },
  { label: 'やること化', value: 20, color: C.blue500 },
  { label: '選考の管理', value: 10, color: C.blue200 },
]

const appSeg: Seg[] = [
  { label: 'Inbox', value: 62, color: C.blue800 },
  { label: 'Insight', value: 20, color: C.blue600 },
  { label: 'Status', value: 12, color: C.blue500 },
  { label: 'Prep', value: 5, color: C.blue200 },
]

export default function App() {
  const totalSaved = savedHours.reduce((n, v) => n + v, 0)
  return (
    <div className="flex min-h-screen">
      <AppNav current="impact" />
      <div className="min-h-screen min-w-0 flex-1 pb-14 md:pb-0">
        <header className="sticky top-0 z-10 border-b border-slate-300 bg-white">
          <div className="flex items-center gap-2.5 px-6 py-3">
            <h1 className="flex items-baseline gap-2.5">
              <span className="text-lg font-bold tracking-tight text-slate-900">効果</span>
              <span className="hidden text-xs font-normal text-slate-500 sm:inline">
                katazuku が生んだ成果を、数字で。
              </span>
            </h1>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-6 py-8">
          {/* アウトカムの要約 */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiTile label="取り戻した時間(累計)" value={`${totalSaved}`} unit="時間" delta="月あたり平均 約8時間" />
            <KpiTile label="見落とした締切" value="0" unit="件" delta="捕捉 398件 / 落とし 0" />
            <KpiTile label="進行中の選考" value="6" unit="社" delta="面接 2 ・ 内定 1" />
            <KpiTile label="片付けたタスク" value="512" unit="件" delta="今月 58 件" />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <BarChart
              title="取り戻した時間の推移"
              hint="時間 / 月"
              values={savedHours}
              color={C.blue500}
              unit="時間"
              className="lg:col-span-2"
            />

            <Donut
              title="取り戻した時間の内訳"
              centerValue={`${totalSaved}h`}
              centerLabel="累計削減"
              segments={effectSeg}
              unit="時間"
            />
            <Donut
              title="アプリ別の貢献(時間)"
              centerValue={`${totalSaved}h`}
              centerLabel="累計削減"
              segments={appSeg}
              unit="時間"
            />

            <StackedBarChart
              title="自動処理した件数の月次内訳"
              hint="件 / 月"
              series={stackSeries}
              unit="件"
              className="lg:col-span-2"
            />

            <BarChart title="新規メールの自動処理" hint="通 / 月" values={newMail} color={C.blue600} unit="通" />
            <BarChart title="締切の捕捉" hint="件 / 月" values={deadlineCaught} color={C.blue500} unit="件" />
            <BarChart title="防いだ締切遅れ" hint="件 / 月" values={delayPrevented} color={C.red500} unit="件" />
            <BarChart title="防いだ見落とし" hint="件 / 月" values={missAvoided} color={C.red500} unit="件" />
          </div>
        </main>
      </div>
    </div>
  )
}
