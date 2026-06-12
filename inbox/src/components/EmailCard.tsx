import { CATEGORY_META, type Email } from '../types'
import { formatDateShort, formatRemaining, urgencyOf, type Urgency } from '../lib/dates'
import { SELECTION_META } from '../lib/selection'

interface Props {
  email: Email
  now: Date
  selected: boolean
  expanded: boolean
  onToggle: () => void
  onDone: () => void
  onSnooze: () => void
  onRestore: () => void
  onAddToPipeline: () => void
}

const URGENCY_BAR: Record<Urgency, string> = {
  overdue: 'bg-red-600',
  critical: 'bg-red-500',
  soon: 'bg-slate-400',
  normal: 'bg-slate-200',
}

const URGENCY_BADGE: Record<Urgency, string> = {
  overdue: 'bg-red-600 text-white',
  critical: 'bg-red-50 text-red-700 ring-1 ring-red-200',
  soon: 'bg-slate-100 text-slate-600',
  normal: 'bg-slate-100 text-slate-500',
}

function gcalUrl(email: Email): string {
  const start = new Date(email.deadline!)
  const end = new Date(start.getTime() + 3600e3)
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `【${email.company}】${email.subject}`,
    dates: `${fmt(start)}/${fmt(end)}`,
    details: email.actionHint ?? '',
  })
  return `https://calendar.google.com/calendar/render?${params}`
}

function receivedLabel(receivedAt: string, now: Date): string {
  const d = new Date(receivedAt)
  if (d.toDateString() === now.toDateString())
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
  return formatDateShort(d, false)
}

export function EmailCard({
  email,
  now,
  selected,
  expanded,
  onToggle,
  onDone,
  onSnooze,
  onRestore,
  onAddToPipeline,
}: Props) {
  const deadline = email.deadline ? new Date(email.deadline) : null
  const urgency = email.status === 'done' ? 'normal' : urgencyOf(deadline, now)
  const meta = CATEGORY_META[email.category]
  const isDone = email.status === 'done'

  const ghostBtn =
    'rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-50'

  return (
    <article
      data-email-card={email.id}
      className={`group relative flex overflow-hidden rounded-xl border bg-white shadow-sm transition ${
        selected ? 'border-slate-900 ring-2 ring-slate-900/10' : 'border-slate-200 hover:border-slate-300'
      } ${isDone ? 'opacity-60' : ''}`}
    >
      <div className={`w-1 shrink-0 ${URGENCY_BAR[urgency]}`} aria-hidden />

      <div className="min-w-0 flex-1 px-4 py-3">
        <button onClick={onToggle} className="block w-full text-left">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-slate-700">{email.company}</span>
            {email.selectionKind && email.selectionKind !== 'other' && (
              <span
                className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${SELECTION_META[email.selectionKind].color}`}
              >
                {SELECTION_META[email.selectionKind].label}
              </span>
            )}
            <span className="rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200">
              {meta.label}
            </span>
            {email.needsAction && !isDone && (
              <span className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-red-600 ring-1 ring-red-200">
                要対応
              </span>
            )}
            <span className="ml-auto tabular-nums text-slate-400">{receivedLabel(email.receivedAt, now)}</span>
          </div>

          <h3 className={`mt-1.5 truncate text-sm font-bold ${isDone ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
            {email.subject}
          </h3>

          {email.actionHint && (
            <p className="mt-1 flex items-center gap-2 text-xs text-slate-500">
              {deadline && !isDone && (
                <span className={`rounded px-1.5 py-0.5 font-bold tabular-nums ${URGENCY_BADGE[urgency]}`}>
                  {formatRemaining(deadline, now)}
                </span>
              )}
              <span className="truncate">{email.actionHint}</span>
            </p>
          )}

          {(email.actionSteps ?? []).length > 0 && !isDone && (
            <p className="mt-1.5 flex flex-wrap gap-1">
              {(email.actionSteps ?? []).map((step) => (
                <span
                  key={step}
                  className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-600"
                >
                  {step}
                </span>
              ))}
            </p>
          )}
        </button>

        {expanded && (
          <div className="mt-3 border-t border-slate-100 pt-3">
            <p className="mb-2 text-xs text-slate-400">
              From: {email.from} &lt;{email.fromAddress}&gt;
            </p>
            <pre className="max-h-72 overflow-y-auto font-sans text-sm leading-relaxed whitespace-pre-wrap text-slate-600">
              {email.body}
            </pre>
          </div>
        )}

        <div className="mt-2.5 flex items-center gap-2">
          {isDone ? (
            <button onClick={onRestore} className={ghostBtn}>
              受信トレイに戻す
            </button>
          ) : (
            <>
              <button
                onClick={onDone}
                className="rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-700"
              >
                片付けた
              </button>
              {email.actionUrl && (
                <a href={email.actionUrl} target="_blank" rel="noreferrer" className={ghostBtn} title={email.actionUrl}>
                  フォームを開く ↗
                </a>
              )}
              <button onClick={onSnooze} className={ghostBtn} title="明日の朝8時に受信トレイへ戻ります">
                明日の朝へ
              </button>
              {deadline && (
                <a href={gcalUrl(email)} target="_blank" rel="noreferrer" className={ghostBtn}>
                  カレンダー
                </a>
              )}
              <button onClick={onAddToPipeline} className={ghostBtn} title="選考管理ボード(Pipeline)にこの企業を追加します">
                選考ボードへ
              </button>
            </>
          )}
        </div>
      </div>
    </article>
  )
}
