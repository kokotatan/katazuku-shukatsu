/**
 * calendar-fetch: Google Calendar を「LLMを一切使わず」取得し、src/db-apply-calendar.ts 用のJSONを書く。
 *
 * なぜ決定的にするか: 予定の取得・正規化・DB反映に判断は要らない。30分ごとにLLMへ丸ごと投げると
 * provider の利用枠を食い尽くし、判断が要る処理(mail-watch / asa)まで枠切れで落ちる。
 * LLMを呼ぶのは、企業名を機械的に特定できなかった「要判定」の予定だけ(scripts/calendar-sync.ts)。
 *
 *   npx tsx scripts/calendar-fetch.ts <out.json>
 *   → <out.json>(確定分 + 空き判定用の全予定投影 + 取得状態)と <out>-residue.json(要判定)を書く
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { resolveDatabasePath } from '../src/database-path.js'
import { getGoogleAccessToken } from '../src/google-auth.js'
import { googleRead } from '../src/google-read.js'
import { loadConfig, type KatazukuConfig } from '../src/katazuku-config.js'
import { isMeetingUrl } from '../src/meeting-url.js'

export interface GoogleEvent {
  id: string
  status?: string
  summary?: string
  description?: string
  location?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  attendees?: { displayName?: string; email?: string }[]
  hangoutLink?: string
  transparency?: 'opaque' | 'transparent'
  /** グレー(8)は辞退・不合格・不参加の履歴として残す運用。予定表には残すが占有させない */
  colorId?: string
  calendarId?: string
  accountId?: string
}

export interface CompanyNeedle { needle: string; name: string }

export interface SyncState {
  source: 'google-calendar'
  accountId: string
  scopeId: string
  status: 'success' | 'partial' | 'failed'
  coveredFrom: string
  coveredUntil: string
  attemptedAt: string
  error?: string
}

/** 法人格を落とした照合用の表記(「株式会社サンプル」の予定名が「サンプル」だけでも当たるように) */
function stripCorpSuffix(name: string): string {
  return name.replace(/(株式会社|有限会社|合同会社|一般社団法人|公益財団法人|独立行政法人|\(株\)|（株）)/g, '').trim()
}

/** 企業名の索引(name / short_name / 別名 / 法人格なし)。長い表記を優先して部分一致させる。 */
export function loadCompanyIndex(db: DatabaseSync): CompanyNeedle[] {
  const rows: CompanyNeedle[] = []
  const push = (needle: string, name: string) => {
    const value = needle.trim()
    // 2文字の表記は誤爆の害が大きいので3文字以上に限る
    if (value.length >= 3) rows.push({ needle: value, name })
  }
  for (const row of db.prepare('SELECT name, short_name FROM company').all() as { name: string; short_name: string }[]) {
    if (!row.name) continue
    push(row.name, row.name)
    push(stripCorpSuffix(row.name), row.name)
    if (row.short_name) { push(row.short_name, row.name); push(stripCorpSuffix(row.short_name), row.name) }
  }
  for (const row of db.prepare('SELECT a.alias AS alias, c.name AS name FROM company_alias a JOIN company c ON c.id = a.company_id').all() as { alias: string; name: string }[]) {
    push(row.alias, row.name)
    push(stripCorpSuffix(row.alias), row.name)
  }
  const seen = new Set<string>()
  return rows
    .filter((row) => (seen.has(row.needle + '\u0000' + row.name) ? false : (seen.add(row.needle + '\u0000' + row.name), true)))
    .sort((a, b) => b.needle.length - a.needle.length)
}

/** 選考トラックが複数ある企業。position 無しでは反映できないので要判定へ回す。 */
export function loadMultiTrackCompanies(db: DatabaseSync): Set<string> {
  const rows = db.prepare('SELECT c.name AS name, COUNT(s.id) AS n FROM company c JOIN selection s ON s.company_id = c.id GROUP BY c.id HAVING n > 1').all() as { name: string }[]
  return new Set(rows.map((row) => row.name))
}

/** 取り込み済みの予定は、どのトラックに紐付いたかがDBに残っている。判断は一度きりで以後は事実として再利用する。 */
export function loadKnownPositions(db: DatabaseSync): Map<string, string> {
  const rows = db.prepare(`
    SELECT a.external_id AS eid, s.position AS position
    FROM appointment a JOIN selection s ON s.id = a.selection_id
    WHERE a.external_id <> ''
  `).all() as { eid: string; position: string }[]
  return new Map(rows.filter((row) => row.position).map((row) => [row.eid, row.position]))
}

const KIND_RULES: [RegExp, string][] = [
  [/最終面接|面接|選考会|グループディスカッション|GD/i, '面接'],
  [/面談|1on1|カジュアル|壁打ち|座談/i, '面談'],
  [/説明会|セミナー|イベント|ワークショップ|インターン|見学/i, '説明会'],
  [/テスト|試験|検査|コーディング|webテスト/i, 'テスト'],
  [/締切|〆切|提出|期限/i, '締切'],
]

function pickMeetingUrl(event: GoogleEvent): string | undefined {
  if (event.hangoutLink) return event.hangoutLink
  const urls = `${event.location || ''}\n${event.description || ''}`.match(/https?:\/\/[^\s<>"')]+/g) || []
  return urls.find((url) => isMeetingUrl(url))
}

function eventStart(event: GoogleEvent, offset: string): string {
  return event.start?.dateTime || (event.start?.date ? `${event.start.date}T00:00:00${offset}` : '')
}

function eventEnd(event: GoogleEvent, offset: string): string | undefined {
  return event.end?.dateTime || (event.end?.date ? `${event.end.date}T00:00:00${offset}` : undefined)
}

export interface NormalizedCalendar {
  events: Record<string, unknown>[]
  scheduleBlocks: Record<string, unknown>[]
  residue: Record<string, unknown>[]
  skipped: string[]
  duplicates: number
}

/**
 * 取得した生イベントを、確定分(events)・空き判定用の投影(scheduleBlocks)・要判定(residue)に分ける。
 * 企業名は予定名 → 場所の順で照合し、説明欄は使わない(案内文に出てくる別会社名を拾って誤爆するため)。
 */
export function normalizeCalendarEvents(
  raw: GoogleEvent[],
  context: { companies: CompanyNeedle[]; multiTrack: Set<string>; knownPositions: Map<string, string>; ownAccounts: string[]; utcOffset?: string },
): NormalizedCalendar {
  const offset = context.utcOffset ?? '+09:00'
  const scheduleBlocks = raw.flatMap((event) => {
    if (!event.id) return []
    const allDay = Boolean(event.start?.date)
    const startAt = eventStart(event, offset)
    if (!startAt) return []
    let endAt = eventEnd(event, offset) ?? ''
    if (!endAt) {
      const startMs = Date.parse(startAt)
      if (Number.isNaN(startMs)) return []
      endAt = new Date(startMs + (allDay ? 86_400_000 : 3_600_000)).toISOString()
    }
    const inactive = event.status === 'cancelled' || event.colorId === '8'
    return [{
      provider: 'google-calendar',
      accountId: event.accountId || '',
      calendarId: event.calendarId || '',
      externalId: event.id,
      startAt,
      endAt,
      title: (event.summary || '').trim(),
      allDay,
      busy: !inactive && event.transparency !== 'transparent',
      status: event.status === 'cancelled' ? 'cancelled' : 'active',
    }]
  })

  const events: Record<string, unknown>[] = []
  const residue: Record<string, unknown>[] = []
  const skipped: string[] = []
  for (const event of raw) {
    const title = (event.summary || '').trim()
    const startAt = eventStart(event, offset)
    if (!title || !startAt) continue
    // 移動・宿泊の予定は選考予定ではない(社名が入っていても appointment にしない)
    if (/^(移動|交通|出発|帰宅|宿泊|前泊)/.test(title)) { skipped.push(title); continue }
    const hit = context.companies.find((company) => title.includes(company.needle))
      || context.companies.find((company) => (event.location || '').includes(company.needle))
    const base = {
      externalId: event.id,
      calendarId: event.calendarId || '',
      title,
      startAt,
      endAt: eventEnd(event, offset),
      location: event.location || undefined,
      url: pickMeetingUrl(event),
    }
    if (!hit) {
      // 選考予定に見えるが企業を特定できないもの(略称・製品名だけの予定)は捨てずに要判定へ
      if (KIND_RULES.some(([re]) => re.test(title)) || /エントリー|ES|選考/i.test(title)) {
        residue.push({ ...base, description: (event.description || '').slice(0, 400) || undefined })
      } else {
        skipped.push(title)
      }
      continue
    }
    const knownPosition = context.knownPositions.get(event.id)
    if (context.multiTrack.has(hit.name) && !knownPosition) {
      residue.push({ ...base, company: hit.name, needsPosition: true, description: (event.description || '').slice(0, 400) || undefined })
      continue
    }
    const attendees = (event.attendees || [])
      .map((attendee) => ({ name: (attendee.displayName || attendee.email || '').trim() }))
      .filter((attendee) => attendee.name && !context.ownAccounts.some((account) => attendee.name.includes(account)))
    events.push({
      ...base,
      company: hit.name,
      position: knownPosition || undefined,
      kind: KIND_RULES.find(([re]) => re.test(title))?.[1] || 'その他',
      status: event.status === 'cancelled' || event.colorId === '8' ? '中止' : '予定',
      attendees: attendees.length ? attendees : undefined,
    })
  }
  // 同じ予定が複数カレンダーにあると2件になる。予定名+開始時刻(分まで)で重複を落とす
  const seen = new Set<string>()
  const deduped = events.filter((event) => {
    const key = `${event.title}|${String(event.startAt).slice(0, 16)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return { events: deduped, scheduleBlocks, residue, skipped, duplicates: events.length - deduped.length }
}

async function listTargetCalendars(token: string): Promise<string[]> {
  const response = await googleRead('https://www.googleapis.com/calendar/v3/users/me/calendarList', token)
  if (!response.ok) throw new Error(`カレンダー一覧の取得に失敗(HTTP ${response.status})`)
  const json = (await response.json()) as { items?: { id: string; summary?: string; selected?: boolean }[] }
  // 祝日・連絡先の誕生日・週番号などの自動生成カレンダーは対象外
  return (json.items || [])
    .filter((calendar) => !/holiday|contacts|weeknum/i.test(calendar.id) && !/誕生日/.test(calendar.summary || ''))
    .map((calendar) => calendar.id)
}

async function listEvents(token: string, calendarId: string, accountId: string, from: string, until: string): Promise<GoogleEvent[]> {
  const out: GoogleEvent[] = []
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({
      timeMin: from, timeMax: until, singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
      // 中止(cancelled)も持ち帰り、DB側で「中止」に落とせるようにする
      showDeleted: 'true',
    })
    if (pageToken) params.set('pageToken', pageToken)
    const response = await googleRead(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`, token)
    if (!response.ok) throw new Error(`カレンダー取得に失敗(HTTP ${response.status})`)
    const json = (await response.json()) as { items?: GoogleEvent[]; nextPageToken?: string }
    for (const item of json.items || []) out.push({ ...item, calendarId, accountId })
    pageToken = json.nextPageToken
  } while (pageToken)
  return out
}

export async function fetchCalendar(config: KatazukuConfig, now: Date = new Date()): Promise<{ raw: GoogleEvent[]; syncStates: SyncState[]; calendars: number }> {
  const from = new Date(now.getTime() - config.google.calendarPastDays * 86_400_000).toISOString()
  const until = new Date(now.getTime() + config.google.calendarFutureDays * 86_400_000).toISOString()
  const raw: GoogleEvent[] = []
  const syncStates: SyncState[] = []
  let calendars = 0
  for (const account of config.google.accounts) {
    const scopeId = account.calendars === 'all-visible' ? 'visible-calendars' : 'primary'
    const state = (status: SyncState['status'], error?: string): SyncState => ({
      source: 'google-calendar', accountId: account.email, scopeId, status,
      coveredFrom: from, coveredUntil: until, attemptedAt: now.toISOString(), error,
    })
    let token: string
    let targets: string[]
    try {
      token = await getGoogleAccessToken(account.email, config.google.credentialsDir)
      targets = account.calendars === 'all-visible' ? await listTargetCalendars(token) : [account.email]
    } catch (error) {
      // 未認証のアカウントがあっても、他のアカウントの同期は止めない
      console.error(`[${account.id}] スキップ: ${(error as Error).message}`)
      syncStates.push(state('failed', 'token or calendar list unavailable'))
      continue
    }
    calendars += targets.length
    let failed = 0
    for (const calendarId of targets) {
      try {
        raw.push(...await listEvents(token, calendarId, account.email, from, until))
      } catch (error) {
        failed += 1
        console.error(`[${account.id}] カレンダー1件の取得に失敗(スキップ): ${(error as Error).message}`)
      }
    }
    syncStates.push(state(failed === 0 && targets.length > 0 ? 'success' : failed < targets.length ? 'partial' : 'failed',
      failed ? `${failed}/${targets.length} calendars failed` : undefined))
  }
  return { raw, syncStates, calendars }
}

export function utcOffsetFor(timeZone: string, at: Date = new Date()): string {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(at)
    .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT'
  const match = name.match(/GMT([+-]\d{2}):?(\d{2})?/)
  return match ? `${match[1]}:${match[2] ?? '00'}` : '+00:00'
}

export async function runCalendarFetch(outPath: string, config: KatazukuConfig = loadConfig()): Promise<{ written: number; residue: number; residuePath: string }> {
  const db = new DatabaseSync(resolveDatabasePath(), { readOnly: true })
  let companies: CompanyNeedle[]
  let multiTrack: Set<string>
  let knownPositions: Map<string, string>
  try {
    companies = loadCompanyIndex(db)
    multiTrack = loadMultiTrackCompanies(db)
    knownPositions = loadKnownPositions(db)
  } finally {
    db.close()
  }
  const { raw, syncStates, calendars } = await fetchCalendar(config)
  const normalized = normalizeCalendarEvents(raw, {
    companies, multiTrack, knownPositions,
    ownAccounts: config.google.accounts.map((account) => account.email),
    utcOffset: utcOffsetFor(config.profile.timezone),
  })
  writeFileSync(outPath, JSON.stringify({ events: normalized.events, scheduleBlocks: normalized.scheduleBlocks, syncStates }, null, 2), 'utf8')
  const residuePath = outPath.replace(/\.json$/, '') + '-residue.json'
  writeFileSync(residuePath, JSON.stringify({ events: normalized.residue }, null, 2), 'utf8')
  // 取り込まなかった予定が「静かに消える」のが最悪なので、件数は必ず出す
  console.error(`取得${raw.length}件(${config.google.accounts.length}アカウント・カレンダー${calendars}個) → 占有${normalized.scheduleBlocks.length}件 / 就活確定${normalized.events.length}件(重複${normalized.duplicates}件除去) / 要判定${normalized.residue.length}件 / 対象外${normalized.skipped.length}件`)
  return { written: normalized.events.length, residue: normalized.residue.length, residuePath }
}

const invokedDirectly = process.argv[1] != null && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
if (invokedDirectly) {
  const out = process.argv[2]
  if (!out) {
    console.error('使い方: npx tsx scripts/calendar-fetch.ts <out.json>')
    process.exit(1)
  }
  console.log(JSON.stringify(await runCalendarFetch(resolve(out))))
}
