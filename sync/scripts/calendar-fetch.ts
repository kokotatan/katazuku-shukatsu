/**
 * calendar-fetch: Google Calendar を「LLMを一切使わず」取得し、db-apply-calendar 用のJSONを書く。
 *
 * なぜ(2026-07-31): calendar-syncは30分ごと=1日48回、LLM(claude/codex)の枠を消費していた。
 * 中身は「予定を取る→正規化する→db-apply-calendarに渡す」だけで判断が要らない。
 * これがproviderの枠を食い尽くし、mail-watch や asa など判断の要る処理まで
 * quota_exhausted で落ちる原因になっていた(直近5日で quota_exhausted 130回)。
 * 認証は google-workspace MCP が保存済みのOAuthトークン(refresh_token)を再利用する。
 *
 * 使い方: npx tsx scripts/calendar-fetch.ts [出力json]
 *   既定の出力は sync/calendar-import-loop.json(db-apply-calendar.ts の入力)
 * 環境変数:
 *   KATAZUKU_CAL_ACCOUNT  取得に使うGoogleアカウント(既定 okuyama.kotaro.career@gmail.com)
 *   KATAZUKU_CAL_PAST_DAYS / KATAZUKU_CAL_FUTURE_DAYS  取得範囲(既定 7 / 60)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const ACCOUNT = process.env.KATAZUKU_CAL_ACCOUNT || 'okuyama.kotaro.career@gmail.com'
const PAST_DAYS = Number(process.env.KATAZUKU_CAL_PAST_DAYS || 7)
const FUTURE_DAYS = Number(process.env.KATAZUKU_CAL_FUTURE_DAYS || 60)
const DB_PATH = process.env.KATAZUKU_DB_PATH || join(REPO, 'data', 'katazuku.db')

interface StoredToken {
  refresh_token: string
  client_id: string
  client_secret: string
  token_uri?: string
}

/** MCPが保存したOAuthトークンからアクセストークンを得る。秘密値はログに出さない。 */
async function getAccessToken(): Promise<string> {
  const path = join(process.env.USERPROFILE || process.env.HOME || '', '.google_workspace_mcp', 'credentials', `${ACCOUNT}.json`)
  let stored: StoredToken
  try {
    stored = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw new Error(`OAuthトークンを読めません: ${path}(google-workspace MCPで一度認証してください)`)
  }
  if (!stored.refresh_token) throw new Error('refresh_tokenがありません。再認証が必要です')
  const res = await fetch(stored.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: stored.client_id,
      client_secret: stored.client_secret,
      refresh_token: stored.refresh_token,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) throw new Error(`アクセストークンの取得に失敗(HTTP ${res.status})。再認証が必要かもしれません`)
  const json = (await res.json()) as { access_token?: string }
  if (!json.access_token) throw new Error('アクセストークンが応答に含まれていません')
  return json.access_token
}

interface GEvent {
  id: string
  status?: string
  summary?: string
  description?: string
  location?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  attendees?: { displayName?: string; email?: string }[]
  hangoutLink?: string
  recurringEventId?: string
}

/** 就活予定が載りうるカレンダーを選ぶ。祝日・家族は対象外(私用・自動生成のため)。 */
async function listTargetCalendars(token: string): Promise<string[]> {
  const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`カレンダー一覧の取得に失敗(HTTP ${res.status})`)
  const json = (await res.json()) as { items?: { id: string; summary?: string; primary?: boolean }[] }
  return (json.items || [])
    .filter((c) => !/holiday|contacts|weeknum/i.test(c.id) && !/家族|誕生日/.test(c.summary || ''))
    .map((c) => c.id)
}

async function listEvents(token: string, calendarId: string): Promise<GEvent[]> {
  const now = Date.now()
  const timeMin = new Date(now - PAST_DAYS * 86400000).toISOString()
  const timeMax = new Date(now + FUTURE_DAYS * 86400000).toISOString()
  const out: GEvent[] = []
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({
      timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
      // 中止(cancelled)も status として持ち帰り、DB側で「中止」に落とせるようにする
      showDeleted: 'true',
    })
    if (pageToken) params.set('pageToken', pageToken)
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`カレンダー取得に失敗(${calendarId}: HTTP ${res.status})`)
    const json = (await res.json()) as { items?: GEvent[]; nextPageToken?: string }
    for (const item of json.items || []) out.push({ ...item, calendarId } as GEvent & { calendarId: string })
    pageToken = json.nextPageToken
  } while (pageToken)
  return out
}

/** 法人格を落とした照合用の表記(「セーフィー株式会社」の予定名が「セーフィー」だけでも当たるように) */
function stripCorpSuffix(name: string): string {
  return name
    .replace(/(株式会社|有限会社|合同会社|一般社団法人|公益財団法人|独立行政法人|\(株\)|（株）)/g, '')
    .trim()
}

/**
 * 選考トラックが複数ある企業。db-apply-calendar は position 無しでは
 * 「複数トラックのため position が必要です」で全体を失敗させるため、
 * これらは機械的に決められない=要判定として後段のLLMへ回す。
 */
function loadMultiTrackCompanies(): Set<string> {
  const db = new DatabaseSync(DB_PATH, { readOnly: true })
  const rows = db.prepare(
    'select c.name as name, count(s.id) as n from company c join selection s on s.company_id = c.id group by c.id having n > 1',
  ).all() as any[]
  db.close()
  return new Set(rows.map((r) => String(r.name)))
}

/**
 * 既に取り込み済みの予定は、どの選考トラックに紐付いたかがDBに残っている。
 * externalId → position を引いておけば、複数トラック企業でも2回目以降はLLMが要らない。
 * (初回だけ判断が要る。判断は一度きりで、以後は事実として再利用する)
 */
function loadKnownPositions(): Map<string, string> {
  const db = new DatabaseSync(DB_PATH, { readOnly: true })
  const rows = db.prepare(
    `select a.external_id as eid, s.position as position
       from appointment a join selection s on s.id = a.selection_id
      where a.external_id is not null and a.external_id != ''`,
  ).all() as any[]
  db.close()
  const map = new Map<string, string>()
  for (const r of rows) if (r.eid && r.position) map.set(String(r.eid), String(r.position))
  return map
}

/** 企業名の索引(name / short_name / 別名 / 法人格なし)。長い表記を優先して部分一致させる。 */
function loadCompanyIndex(): { needle: string; name: string }[] {
  const db = new DatabaseSync(DB_PATH, { readOnly: true })
  const rows: { needle: string; name: string }[] = []
  const push = (needle: string, name: string) => {
    const n = needle.trim()
    if (n.length >= 3) rows.push({ needle: n, name })
  }
  for (const r of db.prepare('select name, short_name from company').all() as any[]) {
    if (!r.name) continue
    const name = String(r.name)
    push(name, name)
    push(stripCorpSuffix(name), name)
    if (r.short_name) { push(String(r.short_name), name); push(stripCorpSuffix(String(r.short_name)), name) }
  }
  try {
    for (const r of db.prepare('select a.alias as alias, c.name as name from company_alias a join company c on c.id = a.company_id').all() as any[]) {
      if (r.alias && r.name) { push(String(r.alias), String(r.name)); push(stripCorpSuffix(String(r.alias)), String(r.name)) }
    }
  } catch { /* company_alias が無い構成でも動く */ }
  db.close()
  // 長い表記から先に照合する(「リンクアンドモチベーション」が「リンク」に負けないように)。
  // 2文字の需要(「NTT」等)より誤爆の害が大きいので3文字以上に限る。
  const seen = new Set<string>()
  return rows
    .filter((r) => (seen.has(r.needle + ' ' + r.name) ? false : (seen.add(r.needle + ' ' + r.name), true)))
    .sort((a, b) => b.needle.length - a.needle.length)
}

const KIND_RULES: [RegExp, string][] = [
  [/最終面接|面接|選考会|グループディスカッション|GD/i, '面接'],
  [/面談|1on1|カジュアル|壁打ち|座談/i, '面談'],
  [/説明会|セミナー|イベント|ワークショップ|インターン|見学/i, '説明会'],
  [/テスト|試験|検査|コーディング|webテスト/i, 'テスト'],
  [/締切|〆切|提出|期限/i, '締切'],
]

const URL_RE = /https?:\/\/[^\s<>"')]+/g
const MEETING_HOST = /(meet\.google\.com|zoom\.us|teams\.microsoft\.com|teams\.live\.com|whereby\.com|weburl\.jp|bit\.ly|tinyurl\.com|x\.gd|cutt\.ly|is\.gd|t\.co|lnkd\.in|ur0\.cc|urx\.nu|buff\.ly|rebrand\.ly)/i

function pickMeetingUrl(e: GEvent): string | undefined {
  if (e.hangoutLink) return e.hangoutLink
  const hay = `${e.location || ''}\n${e.description || ''}`
  const urls = hay.match(URL_RE) || []
  return urls.find((u) => MEETING_HOST.test(u))
}

function main() {
  const outPath = resolve(process.argv[2] || join(REPO, 'sync', 'calendar-import-loop.json'))
  const companies = loadCompanyIndex()
  const multiTrack = loadMultiTrackCompanies()
  const knownPositions = loadKnownPositions()

  return (async () => {
    const token = await getAccessToken()
    const calendars = await listTargetCalendars(token)
    const raw: GEvent[] = []
    for (const cid of calendars) raw.push(...(await listEvents(token, cid)))
    const events: Record<string, unknown>[] = []
    const skipped: string[] = []
    // 企業名を決定的に特定できなかった「就活っぽい」予定。ここだけを後段のLLMに渡す。
    const residue: Record<string, unknown>[] = []

    for (const e of raw) {
      const title = (e.summary || '').trim()
      if (!title) continue
      const startAt = e.start?.dateTime || (e.start?.date ? `${e.start.date}T00:00:00+09:00` : '')
      if (!startAt) continue

      // 移動・交通の予定は選考予定ではないので取り込まない(社名が入っていても appointment にしない)
      if (/^(移動|交通|出発|帰宅|宿泊|前泊)/.test(title)) { skipped.push(title); continue }

      // 企業名は予定名から取るのを最優先にする。説明欄まで含めて探すと、案内文に出てくる
      // 別の会社名を拾って誤爆する(実測: キーエンスの予定がキャディ、HacobuがSansanになった)。
      // 予定名で見つからないときだけ場所を見る。説明欄は照合に使わない。
      const hit = companies.find((c) => title.includes(c.needle))
        || companies.find((c) => (e.location || '').includes(c.needle))
      if (!hit) {
        // 企業名は当たらないが選考予定に見えるもの(「リンモチ面接」「バクラク ハッカソン」等、
        // DBに無い略称・製品名)は捨てず、判断が要る残りとして分離する。ここだけLLMに回す。
        if (KIND_RULES.some(([re]) => re.test(title)) || /締切|〆切|エントリー|ES|選考|インターン/i.test(title)) {
          residue.push({
            externalId: e.id, calendarId: (e as any).calendarId, title,
            startAt, endAt: e.end?.dateTime || e.end?.date,
            location: e.location || undefined,
            description: (e.description || '').slice(0, 400) || undefined,
            url: pickMeetingUrl(e),
          })
        } else {
          skipped.push(title)
        }
        continue
      }

      // 複数トラックの企業は position が要る。過去に取り込み済みならDBから引けるので使い、
      // 初回だけ要判定へ回す(position 無しで渡すと db-apply-calendar が例外で落ち、同期全体が失敗する)。
      const knownPosition = knownPositions.get(e.id)
      if (multiTrack.has(hit.name) && !knownPosition) {
        residue.push({
          externalId: e.id, calendarId: (e as any).calendarId, title,
          startAt, endAt: e.end?.dateTime || e.end?.date,
          company: hit.name, needsPosition: true,
          location: e.location || undefined,
          description: (e.description || '').slice(0, 400) || undefined,
          url: pickMeetingUrl(e),
        })
        continue
      }

      const kind = KIND_RULES.find(([re]) => re.test(title))?.[1] || 'その他'
      const attendees = (e.attendees || [])
        .map((a) => ({ name: (a.displayName || a.email || '').trim() }))
        .filter((a) => a.name && !a.name.includes(ACCOUNT))

      events.push({
        externalId: e.id,
        calendarId: (e as any).calendarId || ACCOUNT,
        title,
        startAt,
        endAt: e.end?.dateTime || (e.end?.date ? `${e.end.date}T00:00:00+09:00` : undefined),
        company: hit.name,
        position: knownPosition || undefined,
        kind,
        url: pickMeetingUrl(e),
        location: e.location || undefined,
        status: e.status === 'cancelled' ? '中止' : '予定',
        attendees: attendees.length ? attendees : undefined,
      })
    }

    // 同じ予定が career と個人の両カレンダーにあると2件になる。予定名+開始時刻で重複を落とす
    // (先に来た方=カレンダー一覧の順で primary 側を残す)。
    const seenKey = new Set<string>()
    const deduped = events.filter((e) => {
      const key = `${e.title}|${String(e.startAt).slice(0, 16)}`
      if (seenKey.has(key)) return false
      seenKey.add(key)
      return true
    })
    const dupCount = events.length - deduped.length

    writeFileSync(outPath, JSON.stringify({ events: deduped }, null, 2), 'utf8')
    // 判断が要る残りは別ファイルへ。呼び出し側はこれが空でないときだけLLMを起動する。
    const residuePath = outPath.replace(/\.json$/, '') + '-residue.json'
    writeFileSync(residuePath, JSON.stringify({ events: residue }, null, 2), 'utf8')
    // 取り込まなかった予定が「静かに消える」のが最悪なので必ず件数を出す
    console.error(`取得${raw.length}件(カレンダー${calendars.length}個) → 確定${deduped.length}件(重複${dupCount}件除去) / 要判定${residue.length}件 / 対象外${skipped.length}件`)
    if (residue.length) console.error(`要判定: ${residue.slice(0, 6).map((r: any) => r.title).join(' | ')}`)
    console.log(JSON.stringify({ fetched: raw.length, written: deduped.length, duplicates: dupCount, residue: residue.length, skipped: skipped.length, outPath, residuePath }))
  })()
}

await main().catch((e) => {
  console.error(String(e?.message || e))
  process.exit(1)
})
