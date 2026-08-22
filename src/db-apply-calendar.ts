/**
 * カレンダーイベントを appointment へ冪等upsertする。
 * 入力: {events:[{externalId,title,startAt,endAt,company,position?,...}]}
 */
import { readFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DatabaseSync } from 'node:sqlite'
import { addEvent, findAppointmentMatch, openDb } from './db.js'
import { resolveSelectionId, transaction, upsertPerson } from './inputs.js'
import { resolveDatabasePath } from './data-path.js'

interface CalendarEvent {
  externalId: string
  calendarId?: string
  title: string
  startAt: string
  endAt?: string
  company: string
  position?: string
  kind?: string
  url?: string
  location?: string
  status?: string
  attendees?: { name: string; role?: string }[]
  sourceHash?: string
}

interface CalendarInput { events: CalendarEvent[] }

const dbArgIndex = process.argv.indexOf('--db')
const DB_PATH = resolveDatabasePath(dbArgIndex >= 0 ? process.argv[dbArgIndex + 1] : undefined)

function assertInput(value: unknown): asserts value is CalendarInput {
  if (!value || typeof value !== 'object' || !Array.isArray((value as CalendarInput).events)) {
    throw new Error('入力は {events:[...]} 形式です')
  }
  for (const [index, event] of (value as CalendarInput).events.entries()) {
    if (!event.externalId || !event.title || !event.startAt || !event.company) {
      throw new Error(`events[${index}] は externalId/title/startAt/company が必須です`)
    }
    if (Number.isNaN(Date.parse(event.startAt))) throw new Error(`events[${index}].startAt が不正です`)
    if (event.endAt && Number.isNaN(Date.parse(event.endAt))) throw new Error(`events[${index}].endAt が不正です`)
  }
}

export function applyCalendar(
  input: CalendarInput,
  db: DatabaseSync = openDb(DB_PATH),
): { created: number; updated: number; unchanged: number; promoted: number } {
  return transaction(db, () => {
    const result = { created: 0, updated: 0, unchanged: 0, promoted: 0 }
    for (const event of input.events) {
      const { selectionId, companyId } = resolveSelectionId(db, event.company, event.position)
      const sourceHash = event.sourceHash || createHash('sha256').update(JSON.stringify({
        title: event.title, startAt: event.startAt, endAt: event.endAt || '',
        url: event.url || '', location: event.location || '', status: event.status || '予定',
      })).digest('hex')
      // 所有権(#18): 空の external_id で検索すると、メール由来(external_id 空)の別予定に
      // 誤って当たって書き換えてしまう。空IDは取り違えの元なので拒否する。
      if (!(event.externalId ?? '').trim()) {
        throw new Error('カレンダーイベントに externalId がありません(空IDでの取り違えを防ぐため拒否)')
      }
      let prior = db.prepare('SELECT id, selection_id, source_hash, title, person, external_id FROM appointment WHERE external_id = ?')
        .get(event.externalId) as { id: number; selection_id: number; source_hash: string; title: string; person: string; external_id: string } | undefined
      // external_idで当たらないとき、同じ会議がメール由来(external_id空)で既に入っていないか探す。
      // 見つかったら新規作成せず、その行にexternal_id/calendar_idを埋めて「昇格」させる。
      // 昇格させないと、同じ会議がカレンダー由来とメール由来で2行になり、meeting-autopilotが
      // 同じURLを二重に開いて録音も二重起動する(2026-07-24の実害)。
      let promoted = false
      if (!prior) {
        const matchId = findAppointmentMatch(db, {
          selectionId,
          at: event.startAt,
          title: event.title,
          url: event.url,
          kind: event.kind,
          onlyWithoutExternalId: true,
        })
        if (matchId !== undefined) {
          prior = db.prepare('SELECT id, selection_id, source_hash, title, person, external_id FROM appointment WHERE id = ?')
            .get(matchId) as { id: number; selection_id: number; source_hash: string; title: string; person: string; external_id: string }
          promoted = true
        }
      }
      let appointmentId: number
      if (prior) {
        appointmentId = prior.id
        if (!promoted && prior.source_hash === sourceHash) {
          result.unchanged += 1
        } else {
          // どちらを残すか(2026-07-24の方針):
          // - 時刻・URL・場所・状態・タイトルはカレンダーが正。本人が実際に見て相手と共有している
          //   予定表の表記に揃える(メール由来はテキスト解析の推測で、敬称・調整担当が混ざる)
          // - 相手(person)はカレンダー側が空なら既存を残す。出席者未登録の招待で、せっかく
          //   メールから拾った相手名を空で潰さないため
          // - 統合で置き換えた旧タイトル・旧相手はイベント台帳に1行残すので情報は失われない
          const attendees = (event.attendees || []).map((a) => a.name).join('、')
          // external_idで確定した既存予定は、カレンダー側の会社/職種の再解釈で別トラックへ勝手に移さない
          // (トラック乗っ取り防止)。昇格は同一トラック内で突合しているので selectionId をそのまま使う。
          const targetSelectionId = promoted ? selectionId : prior.selection_id
          if (!promoted && prior.selection_id !== selectionId) {
            addEvent(db, prior.selection_id, '予定注記',
              `カレンダー再解決で別トラック(selection_id=${selectionId})に見えたが、既存トラックを維持`,
              'calendar-sync', event.startAt, event.externalId)
          }
          db.prepare(`
            UPDATE appointment SET selection_id = ?, at = ?, end_at = ?, kind = ?, title = ?,
              url = ?, location = ?, person = CASE WHEN ? <> '' THEN ? ELSE person END,
              status = CASE WHEN ? = '中止' THEN '中止' WHEN status IN ('完了','中止') THEN status ELSE ? END,
              external_id = ?, calendar_id = ?, source_hash = ?
            WHERE id = ?
          `).run(
            targetSelectionId, event.startAt, event.endAt || '', event.kind || 'その他', event.title,
            event.url || '', event.location || '',
            attendees, attendees,
            // 済んだ予定(完了)を再同期で「予定」へ巻き戻さない。中止だけは反映する。
            event.status === 'cancelled' || event.status === '中止' ? '中止' : '予定',
            event.status === 'cancelled' || event.status === '中止' ? '中止' : '予定',
            event.externalId, event.calendarId || '', sourceHash, appointmentId,
          )
          if (promoted) {
            addEvent(
              db, targetSelectionId, '予定統合',
              `メール由来の予定(タイトル: ${prior.title} / 相手: ${prior.person || '不明'})をカレンダー予定「${event.title}」へ統合`,
              'calendar-sync', event.startAt, event.externalId,
            )
            result.promoted += 1
          } else {
            addEvent(db, targetSelectionId, '予定更新', `カレンダー更新: ${event.title}`, 'calendar-sync', event.startAt, event.externalId)
          }
          result.updated += 1
        }
      } else {
        const inserted = db.prepare(`
          INSERT INTO appointment
            (selection_id, at, end_at, kind, title, url, location, person, status, created_at,
             external_id, calendar_id, source_hash)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          selectionId, event.startAt, event.endAt || '', event.kind || 'その他', event.title,
          event.url || '', event.location || '',
          (event.attendees || []).map((a) => a.name).join('、'),
          event.status === 'cancelled' || event.status === '中止' ? '中止' : '予定',
          new Date().toISOString(), event.externalId, event.calendarId || '', sourceHash,
        )
        appointmentId = Number(inserted.lastInsertRowid)
        addEvent(db, selectionId, '予定追加', `カレンダー追加: ${event.title}`, 'calendar-sync', event.startAt, event.externalId)
        result.created += 1
      }
      for (const attendee of event.attendees || []) {
        if (!attendee.name.trim()) continue
        const personId = upsertPerson(db, {
          name: attendee.name,
          companyId,
          company: event.company,
          role: attendee.role || '',
          metAt: event.startAt,
          howMet: event.kind || 'カレンダー予定',
        })
        db.prepare('INSERT OR IGNORE INTO appointment_person (appointment_id, person_id, role) VALUES (?, ?, ?)')
          .run(appointmentId, personId, attendee.role || '')
      }
      if (/面接|面談/.test(event.kind || event.title)) {
        db.prepare(`
          INSERT OR IGNORE INTO meeting_run (id, appointment_id, state, updated_at)
          VALUES (?, ?, 'armed', ?)
        `).run(randomUUID(), appointmentId, new Date().toISOString())
      }
    }
    return result
  })
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && currentFile === resolve(process.argv[1])) {
  const file = process.argv[2]
  if (!file) throw new Error('使い方: npx tsx scripts/db-apply-calendar.ts <calendar.json>')
  const input: unknown = JSON.parse(readFileSync(resolve(file), 'utf8'))
  assertInput(input)
  console.log(JSON.stringify(applyCalendar(input), null, 2))
}
