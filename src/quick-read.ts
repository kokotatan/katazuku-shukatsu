/**
 * 正本DBの短い読み口(npm run quick と Spark の読み取りツールで共有)。
 * 高頻度の問いを「1問=1回答」のコンパクトな行で返す。書き込みは一切しない。
 *
 * 出力は1行=1事実の縦棒区切り。URLは today のみ表示(会議に入る用)。
 * 重複予定はdb-agendaと同じ規則で畳む(DB掃除が済むまで読む側でも守る)。
 */
import { DatabaseSync } from 'node:sqlite'
import { listAppointments, sameAppointment, type AppointmentRow } from './db.js'

const WD = ['日', '月', '火', '水', '木', '金', '土']
const H = 3600_000

export type Slot = { start: number; end: number; row: AppointmentRow }
export type QuickCommand = 'today' | 'next' | 'conflicts' | 'status'

export function parseSlot(a: AppointmentRow): Slot | null {
  const start = Date.parse(a.at.replace(/\//g, '-'))
  if (isNaN(start)) return null
  const end = a.endAt ? Date.parse(a.endAt.replace(/\//g, '-')) : start + H
  return { start, end: isNaN(end) ? start + H : end, row: a }
}

export function fmtDay(t: number): string {
  const d = new Date(t)
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}(${WD[d.getDay()]})`
}

export function fmtTime(t: number): string {
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function overlaps(a: Slot, b: Slot): boolean {
  return a.start < b.end && b.start < a.end
}

/** 終日(日付だけの)予定か。00:00始まりで23時間以上の幅を終日とみなす */
export function isAllDay(s: Slot): boolean {
  const d = new Date(s.start)
  return d.getHours() === 0 && d.getMinutes() === 0 && s.end - s.start >= 23 * H
}

/** 読み取り専用で正本DBを開く。スキーマ作成・WAL切替をしないので、書き手と競合しない */
export function openDbReadOnly(path: string): DatabaseSync {
  const db = new DatabaseSync(path, { readOnly: true })
  db.exec('PRAGMA busy_timeout = 5000;')
  return db
}

function dedupe(db: DatabaseSync, rows: AppointmentRow[]): AppointmentRow[] {
  const fromCalendar = new Set(
    (db.prepare("SELECT id FROM appointment WHERE external_id <> ''").all() as { id: number }[]).map((r) => r.id),
  )
  const kept: AppointmentRow[] = []
  for (const row of rows) {
    const twin = kept.findIndex((k) => k.selectionId === row.selectionId && sameAppointment(k, row))
    if (twin < 0) kept.push(row)
    else if (!fromCalendar.has(kept[twin].id) && fromCalendar.has(row.id)) kept[twin] = row
  }
  return kept
}

function activeSlots(db: DatabaseSync): Slot[] {
  return dedupe(db, listAppointments(db))
    .filter((a) => a.status === '予定')
    .map(parseSlot)
    .filter((s): s is Slot => s !== null)
    .sort((x, y) => x.start - y.start)
}

function line(s: Slot, withDay: boolean, withUrl: boolean): string {
  const a = s.row
  const day = withDay ? fmtDay(s.start) + ' ' : ''
  const time = isAllDay(s) ? '終日' : a.kind === '締切' ? `〆${fmtTime(s.start)}` : `${fmtTime(s.start)}-${fmtTime(s.end)}`
  const cols = [day + time, a.kind || '-', a.company || '-', a.title]
  if (a.person) cols.push(a.person)
  if (withUrl && a.url) cols.push(a.url)
  return cols.join(' | ')
}

/** 完全な重複行(同じ会社・題名・開始)を1件に畳む。DBの重複汚染をそのまま見せないための読む側の守り */
function foldExactDupes(items: Slot[]): Slot[] {
  const seen = new Set<string>()
  return items.filter((s) => {
    const key = `${s.row.company}\u0000${s.row.title}\u0000${s.start}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * today: 今日の予定 全件(締切含む・JST・曜日は機械計算)
 * next [N]: いまから先の予定 N件(既定5)
 * conflicts [日数]: 重なり検出(既定14日先まで)
 * status [語]: 選考ステータス(db-inspectと同じ見え方)
 */
export function quickRead(db: DatabaseSync, cmd: QuickCommand, arg?: string | number, now = Date.now()): string[] {
  const out: string[] = []

  if (cmd === 'today') {
    const d = new Date(now)
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    const dayEnd = dayStart + 24 * H
    const items = foldExactDupes(activeSlots(db).filter((s) => s.start < dayEnd && s.end > dayStart))
    out.push(`今日 ${fmtDay(now)} の予定 ${items.length}件`)
    for (const s of items) out.push(line(s, false, true))
    return out
  }

  if (cmd === 'next') {
    const n = Math.max(1, Number(arg ?? 5) || 5)
    const items = foldExactDupes(activeSlots(db).filter((s) => s.end > now)).slice(0, n)
    out.push(`次の予定 ${items.length}件(現在 ${fmtDay(now)} ${fmtTime(now)})`)
    for (const s of items) out.push(line(s, true, false))
    return out
  }

  if (cmd === 'conflicts') {
    // 締切・終日枠は「時間に参加する」ものではないので衝突判定から外す(締切同士の重なりは意味を持たない)
    const days = Math.max(1, Number(arg ?? 14) || 14)
    const horizon = now + days * 24 * H
    const items = foldExactDupes(
      activeSlots(db).filter((s) => s.end > now && s.start < horizon && s.row.kind !== '締切' && !isAllDay(s)),
    )
    const hits: string[] = []
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (overlaps(items[i], items[j])) {
          hits.push(`${line(items[i], true, false)}\n  × ${line(items[j], true, false)}`)
        }
      }
    }
    out.push(`重なり ${hits.length}件(${days}日先まで)`)
    out.push(...hits)
    return out
  }

  const q = typeof arg === 'string' && arg ? arg : undefined
  const rows = db.prepare(`
    SELECT c.name co, s.season, s.position, s.status
    FROM selection s JOIN company c ON c.id = s.company_id
    ${q ? "WHERE c.name LIKE '%' || ? || '%'" : ''}
    ORDER BY c.name, s.id
  `).all(...(q ? [q] : [])) as { co: string; season: string; position: string; status: string }[]
  for (const r of rows) out.push(`${r.co} | ${r.season || '-'} | ${r.position || '-'} | ${r.status}`)
  out.push(`--- ${rows.length}行`)
  return out
}
