import type { KatazukuData } from '@katazuku/data'

export const activityCategories = {
  schedule: '予定',
  mail: 'メール',
  conversation: '会話・作業',
  record: '面接・提出等',
  automation: '自動処理',
} as const
export type ActivityCategory = keyof typeof activityCategories
export type ActivityFilter = ActivityCategory | 'all'
type Detail = { label: string; value: string }
export interface TimelineEntry {
  id: string
  day: string
  lastDay: string
  time: string
  timestamp: number
  category: ActivityCategory
  label: string
  title: string
  company: string
  summary: string
  details: Detail[]
  source: string
  reference: string
}

const DAY = 86_400_000
const JST = 9 * 3_600_000
const str = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const detail = (label: string, value: unknown): Detail => ({ label, value: str(value) })

export function validDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/** 日付だけの記録に時刻を足さず、オフセットなしの業務日時は日本時間として扱う。 */
export function recordTime(value: unknown) {
  const raw = str(value)
  const day = raw.slice(0, 10)
  if (!validDay(day)) return null
  if (raw === day) return { day, time: '', timestamp: Date.parse(`${day}T00:00:00+09:00`) }
  if (!/^\d{4}-\d{2}-\d{2}[T ](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(raw)) return null
  const iso = raw.replace(' ', 'T')
  const timestamp = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}+09:00`)
  if (!Number.isFinite(timestamp)) return null
  const japan = new Date(timestamp + JST).toISOString()
  return { day: japan.slice(0, 10), time: japan.slice(11, 16), timestamp }
}

export function todayInJapan(now = new Date()): string {
  return new Date(now.getTime() + JST).toISOString().slice(0, 10)
}

export function shiftDay(day: string, offset: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + offset * DAY).toISOString().slice(0, 10)
}

export function shiftMonth(day: string, offset: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1))
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(date.getUTCDate(), last))
  return target.toISOString().slice(0, 10)
}

export function monthDays(day: string): string[] {
  const first = `${day.slice(0, 7)}-01`
  const weekday = new Date(`${first}T00:00:00Z`).getUTCDay()
  const last = new Date(`${shiftMonth(first, 1)}T00:00:00Z`).getTime() - DAY
  const length = Math.ceil((weekday + new Date(last).getUTCDate()) / 7) * 7
  return Array.from({ length }, (_, index) => shiftDay(first, index - weekday))
}

export function dayLabel(day: string, year = false): string {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'UTC', ...(year ? { year: 'numeric' } : {}), month: 'long', day: 'numeric', weekday: 'short',
  }).format(new Date(`${day}T00:00:00Z`))
}

export function safeReferenceUrl(reference: string): string | undefined {
  try {
    const url = new URL(reference)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined
  } catch { return undefined }
}

function sourceCategory(source: string, action = ''): ActivityCategory {
  if (/メール|返信|gmail|email/i.test(action)) return 'mail'
  if (/mail|gmail|email/i.test(source)) return 'mail'
  if (/conversation|codex|claude|session/i.test(source)) return 'conversation'
  if (/sync|autopilot|watch|brief|record-audio|^calendar-/i.test(source)) return 'automation'
  return 'record'
}

function sourceLabel(source: string): string {
  if (/conversation/i.test(source)) return '会話メモ'
  if (/codex/i.test(source)) return 'Codexの作業記録'
  if (/claude/i.test(source)) return 'Claudeの作業記録'
  if (/session/i.test(source)) return '対話中の作業記録'
  return ({ 'calendar-sync': 'カレンダー同期', 'daily-sync': '定期同期', 'mail-watch': 'メール確認',
    'interview-digest': '面接の記録', 'meeting-autopilot': '会議の自動処理', 'submit-agent': '提出の記録',
    'calendar-export': 'カレンダー反映', 'evening-brief': '一日の振り返り' } as Record<string, string>)[source] || source
}

/** 認証済みの記録だけを日付に対応づける。メールの現在の状態から返信日時を推測しない。 */
export function buildActivityTimeline(data: KatazukuData) {
  const entries: TimelineEntry[] = []
  const undated: TimelineEntry[] = []
  const add = (input: Omit<TimelineEntry, 'day' | 'lastDay' | 'time' | 'timestamp'>, at: unknown, endAt?: unknown) => {
    const start = recordTime(at)
    const end = recordTime(endAt)
    const lastDay = start && end && end.timestamp > start.timestamp
      ? todayInJapan(new Date(end.timestamp - 1)) : start?.day || ''
    const entry = { ...input, details: input.details.filter(item => item.value),
      day: start?.day || '', lastDay, time: start?.time || '', timestamp: start?.timestamp || 0 }
    ;(start ? entries : undated).push(entry)
  }
  for (const appointment of data.appointments || []) {
    const end = recordTime(appointment.endAt)
    add({ id: `appointment:${appointment.id}`, category: 'schedule', label: appointment.kind || '予定',
      title: appointment.title || '予定', company: appointment.company, summary: '',
      details: [detail('状態', appointment.status), detail('場所', appointment.location), detail('相手', appointment.person),
        detail('終了', end ? `${dayLabel(end.day)}${end.time ? ` ${end.time}` : ''}` : '')],
      source: 'カレンダー・予定', reference: appointment.url,
    }, appointment.at, appointment.endAt)
  }
  for (const mail of data.mailItems || []) {
    add({ id: `mail:${mail.id}`, category: 'mail', label: 'メール受信', title: mail.subject || '件名なし',
      company: mail.company || '', summary: mail.summary,
      details: [detail('差出人', mail.sender), detail('要約', mail.summary), detail('現在の状態', mail.status)],
      source: 'メール', reference: mail.sourceRef,
    }, mail.receivedAt)
  }
  for (const interview of data.interviews || []) {
    add({ id: `interview:${interview.id}`, category: 'record', label: '面接・面談の記録',
      title: interview.title || '面接・面談', company: interview.company, summary: interview.summary,
      details: [detail('話したこと', interview.summary)], source: '面接記録', reference: interview.sourceRef,
    }, interview.occurredAt)
  }
  for (const submission of data.submissions || []) {
    add({ id: `submission:${submission.id}`, category: /メール|返信/.test(str(submission.kind)) ? 'mail' : 'record',
      label: '提出・対応の記録', title: str(submission.kind) || '提出記録', company: str(submission.company),
      summary: str(submission.detail), details: [detail('内容', submission.detail), detail('結果', submission.result)],
      source: '提出記録', reference: str(submission.sourceRef),
    }, submission.submittedAt)
  }
  for (const dossier of data.dossiers || []) {
    add({ id: `research:${dossier.companyId}`, category: 'record', label: '企業研究', title: '企業研究を更新',
      company: dossier.company, summary: dossier.summary, details: [detail('調べたこと', dossier.summary)],
      source: '企業研究', reference: dossier.sourceRef,
    }, dossier.researchedAt)
  }
  const selections = new Map((data.selections || []).map(selection => [selection.id, selection.company]))
  const seenEvents = new Set<string>()
  for (const event of [...(data.enrichedEvents || []), ...(data.events || [])]) {
    const selectionId = Number(event.selectionId ?? event.selection_id)
    const signature = JSON.stringify([selectionId, event.at, event.kind, event.summary, event.source])
    if (seenEvents.has(signature)) continue
    seenEvents.add(signature)
    const reference = str(event.ref)
    if (reference && event.source === 'interview-digest' && (data.interviews || []).some(item => item.sourceRef === reference)) continue
    if (reference && event.source === 'submit-agent' && (data.submissions || []).some(item => item.sourceRef === reference)) continue
    const source = str(event.source)
    add({ id: `event:${signature}`, category: sourceCategory(source, str(event.kind)), label: str(event.kind) || '活動記録',
      title: str(event.summary) || str(event.kind) || '活動記録', company: str(event.company) || selections.get(selectionId) || '',
      summary: '', details: [], source: sourceLabel(source), reference,
    }, event.at)
  }
  for (const [index, activity] of (data.activities || []).entries()) {
    const source = str(activity.by)
    const category = sourceCategory(source, str(activity.action) || str(activity.what))
    add({ id: `activity:${index}:${activity.ts ?? activity.at}`, category,
      label: sourceLabel(source) || '作業記録', title: str(activity.action) || str(activity.what) || '作業記録',
      company: '', summary: str(activity.how) || str(activity.why),
      details: [detail('目的', activity.why), detail('内容', activity.how), detail('結果', activity.result)],
      source: sourceLabel(source), reference: str(activity.link),
    }, activity.ts || activity.at)
  }
  entries.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id))
  return { entries, undated }
}

export function entriesOnDay(entries: TimelineEntry[], day: string, filter: ActivityFilter = 'all') {
  return entries.filter(entry => entry.day <= day && entry.lastDay >= day && (filter === 'all' || entry.category === filter))
}
