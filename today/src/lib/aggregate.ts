import type { Buckets, InboxEmail, PipelineCompany, TodayItem } from '../types'

export const INBOX_KEY = 'katazuku-inbox/emails'
export const PIPELINE_KEY = 'katazuku-pipeline/companies'

const DAY = 86400e3

function startOfDay(d: Date): Date {
  const s = new Date(d)
  s.setHours(0, 0, 0, 0)
  return s
}

/** スヌーズ復帰前のものは受信トレイ扱いにしない(Inboxと同じ考え方) */
function isActive(e: InboxEmail, now: Date): boolean {
  if (e.status === 'inbox') return true
  if (e.status === 'snoozed' && e.snoozeUntil && new Date(e.snoozeUntil) <= now) return true
  return false
}

export function aggregate(
  emails: InboxEmail[],
  companies: PipelineCompany[],
  now: Date,
): Buckets {
  const items: TodayItem[] = []
  let datelessCount = 0

  for (const e of emails) {
    if (!isActive(e, now) || !e.needsAction) continue
    if (!e.deadline) {
      datelessCount++
      continue
    }
    items.push({
      key: `inbox-${e.id}`,
      source: 'inbox',
      company: e.company,
      title: e.actionSteps?.length ? e.actionSteps.join(' / ') : (e.actionHint ?? e.subject),
      due: e.deadline,
      hasTime: true,
    })
  }

  for (const c of companies) {
    if (!c.nextDate || c.stage === 'offer' || c.stage === 'closed') continue
    items.push({
      key: `pipeline-${c.id}`,
      source: 'pipeline',
      company: c.name,
      title: c.nextAction || '次のアクション未設定',
      due: `${c.nextDate}T23:59:00`,
      hasTime: false,
    })
  }

  items.sort((a, b) => a.due.localeCompare(b.due))

  const todayStart = startOfDay(now).getTime()
  const buckets: Buckets = { overdue: [], today: [], week: [], laterCount: 0, datelessCount }
  for (const item of items) {
    const t = new Date(item.due).getTime()
    if (t < todayStart) buckets.overdue.push(item)
    else if (t < todayStart + DAY) buckets.today.push(item)
    else if (t < todayStart + 7 * DAY) buckets.week.push(item)
    else buckets.laterCount++
  }
  return buckets
}

export function loadJson<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key)
    if (raw !== null) return JSON.parse(raw) as T[]
  } catch {
    // 壊れたデータは空扱い
  }
  return []
}
