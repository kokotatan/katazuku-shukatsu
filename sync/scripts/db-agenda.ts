/**
 * 会議自動運転の司令情報: 直近の「予定」ステータスのappointmentをJSONで出す。
 * meeting-autopilot.ps1 が5分毎にこれを読み、開く/録る/締めるを判断する(正はDBのみ。カレンダーは見ない)。
 * 実行: cd sync && npx tsx scripts/db-agenda.ts
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { openDb, listAppointments, sameAppointment, type AppointmentRow } from '../src/db'
import { isMeetingUrl } from '../src/meeting-url'

const DB_PATH = process.env.KATAZUKU_DB ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'katazuku.db')
const db = openDb(DB_PATH)

/**
 * 司令を出す前の重複除去(2026-07-24)。
 * 突合規則(src/db.ts)を直したので今後は重複行が増えないが、既にDBへ入ってしまった重複行は残る
 * (行の削除は安全機構でブロックされ、掃除は本人承認のうえ別途行う)。
 * 重複を残したまま司令を出すと同じ会議のURLを二重に開き録音も二重に走るため、読む側でも畳む。
 * 残すのはカレンダー由来(external_idあり)を優先。無ければ先に入った行(id昇順の先頭)。
 * 掃除対象の一覧は scripts/check-duplicate-appointments.ts で確認できる。
 */
function dedupe(rows: AppointmentRow[]): AppointmentRow[] {
  // external_id はsnapshotへ出さない内部の値なので、ここで必要なぶんだけ引く
  const fromCalendar = new Set(
    (db.prepare("SELECT id FROM appointment WHERE external_id <> ''").all() as { id: number }[]).map((r) => r.id),
  )
  const kept: AppointmentRow[] = []
  for (const row of rows) {
    const twin = kept.findIndex((k) => k.selectionId === row.selectionId && sameAppointment(k, row))
    if (twin < 0) {
      kept.push(row)
    } else if (!fromCalendar.has(kept[twin].id) && fromCalendar.has(row.id)) {
      kept[twin] = row
    }
  }
  return kept
}

const now = Date.now()
const H = 3600_000
const items = dedupe(listAppointments(db))
  .filter((a) => a.status === '予定')
  .filter((a) => a.kind !== '締切') // 締切は「時間に参加する」ものではないので開く/録るの対象外
  .map((a) => {
    const start = Date.parse(a.at.replace(/\//g, '-'))
    if (isNaN(start)) return null
    const end = a.endAt ? Date.parse(a.endAt.replace(/\//g, '-')) : start + H
    return {
      id: a.id,
      company: a.company,
      title: a.title,
      kind: a.kind,
      url: a.url,
      // 直リンク/短縮リンクなど「開いて録る」対象と判定できたか(短縮リンクは実ブラウザが解決する)
      openable: isMeetingUrl(a.url),
      person: a.person,
      startIso: new Date(start).toISOString(),
      endIso: new Date(isNaN(end) ? start + H : end).toISOString(),
    }
  })
  .filter((a): a is NonNullable<typeof a> => a !== null)
  // 直近2時間前〜48時間先だけが司令対象
  .filter((a) => Date.parse(a.startIso) > now - 2 * H && Date.parse(a.startIso) < now + 48 * H)

console.log(JSON.stringify(items))
