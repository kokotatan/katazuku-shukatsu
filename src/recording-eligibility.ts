/** 会議URLのある予定を自動録音の対象にする。宿泊・インターン参加などは除外する。 */
export interface AutomaticRecordingCandidate {
  kind?: string
  title?: string
  url?: string
  location?: string
  attendanceMode?: string
  startAt?: string
  endAt?: string
  status?: string
  recordable?: boolean
}

export function isAutomaticRecordingEligible(meeting: AutomaticRecordingCandidate): boolean {
  if (meeting.recordable === false) return false
  if (meeting.status && !['予定', 'scheduled'].includes(meeting.status)) return false
  const title = meeting.title || ''
  const content = `${meeting.kind || ''} ${title}`
  if (/宿泊|チェックイン|チェックアウト|ホテル予約/.test(content)) return false
  if (/インターン|internship/i.test(content) && !/面接|面談|説明会|セミナー/.test(title)) return false
  if (meeting.attendanceMode === 'in_person' || /対面|オフライン|来社|訪問|現地/.test(`${title} ${meeting.location || ''}`)) return false

  // 短縮URLや案内ページだけではオンライン会議と確定しない。解決済みの会議URLを使う。
  try {
    const url = new URL(meeting.url || '')
    const host = url.hostname.toLowerCase()
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname === '/') return false
    if (!['meet.google.com', 'zoom.us', 'teams.microsoft.com'].some((h) => host === h || host.endsWith('.' + h))) return false
  } catch { return false }

  const startText = meeting.startAt || ''
  const endText = meeting.endAt || ''
  if (!/[T ]\d{2}:\d{2}/.test(startText) || (endText && !/[T ]\d{2}:\d{2}/.test(endText))) return false
  const start = Date.parse(startText)
  const end = endText ? Date.parse(endText) : start + 3600_000
  return Number.isFinite(start) && Number.isFinite(end) && end > start && end - start < 24 * 3600_000
}
