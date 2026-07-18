/**
 * 正本(選考管理シート)を読むだけのデータ層。
 * この管理画面は自分のデータを一切持たない(書き込みもしない)。
 * タブ名は「選考管理」「企業マスタ」「活動ログ」を前方一致で探す(「(新)」付きでも動く)。
 */

export const SHEET_ID = '1jf6kSy7tZqakw8QocOmMzU6WToncQVQCeIuQ1VfRjMM'
const API = 'https://sheets.googleapis.com/v4/spreadsheets'

/** 選考管理の1行 = 1応募トラック */
export interface Track {
  company: string
  period: string
  position: string
  priority: string
  status: string
  steps: string[]
  nextAction: string
  deadline: string
  deadlineDate: Date | null
  submitted: boolean
  esUrl: string
  memo: string
}

/** 企業マスタの1行。パスワード列は読んでも保持しない */
export interface Master {
  company: string
  /** 正式名称(株式会社/Inc.付き)。A列が正 */
  officialName: string
  industry: string
  mypageUrl: string
  loginId: string
  memo: string
}

export interface Activity {
  ts: string
  by: string
  action: string
  why: string
  how: string
  link: string
  result: string
}

export interface AllData {
  tracks: Track[]
  master: Master[]
  activities: Activity[]
  loadedAt: Date
}

async function getJson(url: string, token: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (res.status === 401) throw new Error('AUTH')
  if (!res.ok) throw new Error(`Sheets API エラー (${res.status})`)
  return res.json()
}

async function getValues(token: string, tab: string, range: string): Promise<string[][]> {
  const r = encodeURIComponent(`'${tab}'!${range}`)
  const data = (await getJson(`${API}/${SHEET_ID}/values/${r}`, token)) as { values?: string[][] }
  return data.values ?? []
}

/** シート上の日付表記(「2026/07/17」「7/17」等)をDateへ。読めなければnull */
export function parseSheetDate(v: string): Date | null {
  const m = v.match(/(?:(\d{4})[/年.-])?(\d{1,2})[/月.-](\d{1,2})/)
  if (!m) return null
  const y = m[1] ? Number(m[1]) : new Date().getFullYear()
  const d = new Date(y, Number(m[2]) - 1, Number(m[3]))
  return isNaN(d.getTime()) ? null : d
}

/** 今日からの残り日数(当日=0、過去は負) */
export function daysLeft(d: Date): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - today.getTime()) / 86400000)
}

function findCol(header: string[], exact: string[], includes: string[] = []): number {
  for (const e of exact) {
    const i = header.findIndex((c) => c === e)
    if (i >= 0) return i
  }
  for (const s of includes) {
    const i = header.findIndex((c) => c.includes(s))
    if (i >= 0) return i
  }
  return -1
}

function parseTracks(rows: string[][]): Track[] {
  const h = rows.findIndex((r) => r.includes('企業名'))
  if (h === -1) return []
  const header = rows[h]
  const c = {
    name: findCol(header, ['企業名']),
    period: findCol(header, ['時期']),
    position: findCol(header, ['ポジション']),
    priority: findCol(header, ['志望度']),
    status: findCol(header, ['ステータス', '出願状況']),
    nextAction: findCol(header, ['次アクション'], ['アクション']),
    deadline: findCol(header, [], ['締切', '〆切']),
    submitted: findCol(header, ['提出済']),
    esUrl: findCol(header, [], ['ES']),
    memo: findCol(header, ['選考メモ', 'メモ欄'], ['メモ']),
  }
  const stepCols = header.map((v, i) => (v.startsWith('選考') && v.length <= 4 ? i : -1)).filter((i) => i >= 0)
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '')
  const out: Track[] = []
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i]
    const name = get(r, c.name)
    if (!name) continue
    const deadline = get(r, c.deadline)
    out.push({
      company: name,
      period: get(r, c.period),
      position: get(r, c.position),
      priority: get(r, c.priority),
      status: get(r, c.status),
      steps: stepCols.map((sc) => get(r, sc)).filter(Boolean),
      nextAction: get(r, c.nextAction),
      deadline,
      deadlineDate: deadline ? parseSheetDate(deadline) : null,
      submitted: get(r, c.submitted).toUpperCase() === 'TRUE',
      esUrl: get(r, c.esUrl),
      memo: get(r, c.memo),
    })
  }
  return out
}

function parseMaster(rows: string[][]): Master[] {
  const h = rows.findIndex((r) => r.includes('正式名称') || r.includes('企業名'))
  if (h === -1) return []
  const header = rows[h]
  const c = {
    official: findCol(header, ['正式名称']),
    name: findCol(header, ['通称', '企業名']),
    industry: findCol(header, ['業界']),
    mypageUrl: findCol(header, [], ['マイページ']),
    loginId: findCol(header, ['ログインID', 'ID']),
    memo: findCol(header, ['会社メモ'], ['メモ']),
  }
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '')
  const out: Master[] = []
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i]
    const name = get(r, c.name) || get(r, c.official)
    if (!name) continue
    // パスワード列は意図的に読まない(画面にも状態にも持ち込まない)
    out.push({
      company: name,
      officialName: get(r, c.official),
      industry: get(r, c.industry),
      mypageUrl: get(r, c.mypageUrl),
      loginId: get(r, c.loginId),
      memo: get(r, c.memo),
    })
  }
  return out
}

function parseActivities(rows: string[][]): Activity[] {
  const h = rows.findIndex((r) => r.includes('日時'))
  if (h === -1) return []
  const out: Activity[] = []
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i].map((v) => (v ?? '').trim())
    if (!r[0]) continue
    out.push({ ts: r[0], by: r[1] ?? '', action: r[2] ?? '', why: r[3] ?? '', how: r[4] ?? '', link: r[5] ?? '', result: r[6] ?? '' })
  }
  return out.reverse() // 新しい順
}

export async function fetchAll(token: string): Promise<AllData> {
  const meta = (await getJson(`${API}/${SHEET_ID}?fields=sheets.properties.title`, token)) as {
    sheets?: { properties: { title: string } }[]
  }
  const titles = (meta.sheets ?? []).map((s) => s.properties.title)
  const pick = (want: string) => titles.find((t) => t.startsWith(want)) ?? titles.find((t) => t.includes(want))
  const trackTab = pick('選考管理')
  const masterTab = pick('企業マスタ')
  const logTab = pick('活動ログ')
  if (!trackTab) throw new Error('「選考管理」タブが見つかりませんでした')

  const [trackRows, masterRows, logRows] = await Promise.all([
    getValues(token, trackTab, 'A1:T400'),
    masterTab ? getValues(token, masterTab, 'A1:F200') : Promise.resolve([]),
    logTab ? getValues(token, logTab, 'A1:G500') : Promise.resolve([]),
  ])

  return {
    tracks: parseTracks(trackRows),
    master: parseMaster(masterRows),
    activities: parseActivities(logRows),
    loadedAt: new Date(),
  }
}
