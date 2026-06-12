export interface ExtractedDate {
  date: Date
  hasTime: boolean
  /** 「まで」「締切」など〆切を示す語が近くにあったか */
  isDeadline: boolean
}

const DEADLINE_CONTEXT =
  /まで|迄|締切|締め切り|〆切|期限|期日|デッドライン|提出|ご?回答|ご?返信|お申し?込み/

// 「2026年6月15日(月) 17:00」「2026/6/15」「6/15 17時」などの日本語日付表現
const DATE_RE =
  /(?:(\d{4})[年/])?(\d{1,2})[月/](\d{1,2})日?(?:[（(][月火水木金土日][)）])?(?:[^\d\n]{0,8}?(\d{1,2})[:時](\d{2})?)?/g

/** テキスト中の日付表現をすべて抽出する */
export function extractDates(text: string, base: Date): ExtractedDate[] {
  const results: ExtractedDate[] = []
  for (const m of text.matchAll(DATE_RE)) {
    const [, yearStr, monthStr, dayStr, hourStr, minStr] = m
    const month = Number(monthStr)
    const day = Number(dayStr)
    if (month < 1 || month > 12 || day < 1 || day > 31) continue

    const hasTime = hourStr !== undefined
    const hour = hasTime ? Number(hourStr) : 23
    if (hour > 23) continue
    const min = hasTime && minStr !== undefined ? Number(minStr) : hasTime ? 0 : 59

    let year = yearStr ? Number(yearStr) : base.getFullYear()
    let date = new Date(year, month - 1, day, hour, min)
    // 年の記載がなく60日以上過去なら、来年の日付とみなす
    if (!yearStr && date.getTime() < base.getTime() - 60 * 24 * 3600e3) {
      date = new Date(year + 1, month - 1, day, hour, min)
    }

    // 「提出期限は【6/29 12:00】」のように〆切語が日付の前に来ることも多い
    const start = m.index ?? 0
    const context = text.slice(Math.max(0, start - 12), start + m[0].length + 14)
    results.push({ date, hasTime, isDeadline: DEADLINE_CONTEXT.test(context) })
  }
  return results
}

/**
 * 抽出した日付から「効いてくる1件」を選ぶ。
 * 未来の〆切 > 未来の予定 > なし の優先順。
 */
export function pickDeadline(
  dates: ExtractedDate[],
  base: Date,
): { date: Date; hasTime: boolean; kind: 'deadline' | 'event' } | null {
  const future = dates.filter((d) => d.date.getTime() > base.getTime() - 24 * 3600e3)
  const byTime = (a: ExtractedDate, b: ExtractedDate) =>
    a.date.getTime() - b.date.getTime()
  const deadline = future.filter((d) => d.isDeadline).sort(byTime)[0]
  if (deadline) return { date: deadline.date, hasTime: deadline.hasTime, kind: 'deadline' }
  const event = future.sort(byTime)[0]
  if (event) return { date: event.date, hasTime: event.hasTime, kind: 'event' }
  return null
}

const WEEKDAYS = '日月火水木金土'

export function formatDateShort(d: Date, hasTime = true): string {
  const w = WEEKDAYS[d.getDay()]
  const time = hasTime
    ? ` ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
    : ''
  return `${d.getMonth() + 1}/${d.getDate()}(${w})${time}`
}

/** 「あと2日」「あと3時間」「今日中」「期限切れ」 */
export function formatRemaining(deadline: Date, now: Date): string {
  const ms = deadline.getTime() - now.getTime()
  if (ms < 0) return '期限切れ'
  const hours = ms / 3600e3
  if (hours < 1) return `あと${Math.max(1, Math.floor(ms / 60e3))}分`
  if (hours < 6) return `あと${Math.floor(hours)}時間`
  if (deadline.toDateString() === now.toDateString()) return '今日中'
  const days = Math.ceil((startOfDay(deadline).getTime() - startOfDay(now).getTime()) / (24 * 3600e3))
  if (days === 1) return '明日まで'
  return `あと${days}日`
}

export type Urgency = 'overdue' | 'critical' | 'soon' | 'normal'

export function urgencyOf(deadline: Date | null, now: Date): Urgency {
  if (!deadline) return 'normal'
  const ms = deadline.getTime() - now.getTime()
  if (ms < 0) return 'overdue'
  if (ms < 24 * 3600e3) return 'critical'
  if (ms < 3 * 24 * 3600e3) return 'soon'
  return 'normal'
}

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
