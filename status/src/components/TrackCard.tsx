import { formatDate, type Selection } from '@katazuku/data'

function outcomeClass(outcome: string): string {
  if (outcome === '内定' || outcome === '合格') return 'bg-green-100 text-green-800'
  if (outcome === '不合格' || outcome === '辞退') return 'bg-slate-200 text-slate-700'
  return 'bg-blue-100 text-blue-800'
}

export function TrackCard({ track }: { track: Selection }) {
  return (
    <article className="rounded-xl border border-slate-300 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-blue-700">{track.priority || '通常'}</p>
          <h2 className="mt-1 text-lg font-bold">{track.company}</h2>
          <p className="mt-1 text-sm text-slate-600">{[track.season, track.position].filter(Boolean).join(' / ') || 'トラック未設定'}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${outcomeClass(track.outcome)}`}>{track.outcome || '進行中'}</span>
      </div>
      <dl className="mt-4 grid gap-3 border-t border-slate-200 pt-4 sm:grid-cols-2">
        <div><dt className="text-xs text-slate-500">現在地</dt><dd className="mt-1 text-sm font-bold">{track.status || '未設定'}</dd></div>
        <div><dt className="text-xs text-slate-500">次にやること</dt><dd className="mt-1 text-sm font-bold">{track.nextAction || '未設定'}</dd></div>
        <div><dt className="text-xs text-slate-500">期限</dt><dd className="mt-1 text-sm">{track.nextDate ? formatDate(track.nextDate, false) : '未設定'}</dd></div>
        <div><dt className="text-xs text-slate-500">提出</dt><dd className="mt-1 text-sm">{track.submitted ? '提出済み' : '未提出'}</dd></div>
      </dl>
    </article>
  )
}
