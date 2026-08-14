/**
 * 予定(appointment)の重複点検。
 *
 * 2026-07-24: 同じある面談が「カレンダー由来(external_idあり)」と「メール由来(external_idなし)」で
 * 2行に割れており、meeting-autopilot が同じURLを二重に開き録音も二重起動しうる状態になっていた。
 * 突合規則(src/db.ts の sameAppointment)は直したが、既に入ってしまった行は残る。
 * このスクリプトは「どの行がどういう根拠で重複か」を一覧するだけで、DBは一切書き換えない
 * (行の削除は安全機構でブロックされる。掃除は本人承認のうえ別途行う)。
 *
 * 実行: cd sync && npx tsx scripts/check-duplicate-appointments.ts [--db <path>] [--json]
 */
import { DatabaseSync } from 'node:sqlite'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeAppointmentAt, normalizeAppointmentUrl, sameAppointment } from '../src/db'

const argv = process.argv.slice(2)
const dbArgIndex = argv.indexOf('--db')
const DB_PATH = dbArgIndex >= 0
  ? resolve(argv[dbArgIndex + 1])
  : (process.env.KATAZUKU_DB_PATH || process.env.KATAZUKU_DB
    || join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'katazuku.db'))
const AS_JSON = argv.includes('--json')

interface Row {
  id: number
  selection_id: number
  at: string
  end_at: string
  kind: string
  title: string
  url: string
  person: string
  status: string
  created_at: string
  external_id: string
  calendar_id: string
  company: string
}

export interface DuplicatePair {
  /** 残す候補(先に作られた側ではなく、カレンダー由来=external_idありを優先) */
  keepId: number
  /** 重複している側 */
  dropId: number
  company: string
  at: string
  reason: string
  confidence: '確定' | '要確認'
  keep: string
  drop: string
}

function label(row: Row): string {
  const origin = row.external_id ? `カレンダー由来(${row.calendar_id || 'calendar'})` : 'メール・手入力由来'
  return `id=${row.id} ${row.kind} 「${row.title}」 person=${row.person || '-'} url=${row.url || '-'} ${origin} created=${row.created_at}`
}

/** 残す方の判定: カレンダー由来(external_idあり)を正とする。同条件ならid(=先に入った方)を残す */
function preferKeep(a: Row, b: Row): [Row, Row] {
  if (Boolean(a.external_id) !== Boolean(b.external_id)) return a.external_id ? [a, b] : [b, a]
  return a.id <= b.id ? [a, b] : [b, a]
}

function overlaps(a: Row, b: Row): boolean {
  const start = (r: Row) => Date.parse(normalizeAppointmentAt(r.at))
  const end = (r: Row) => {
    const e = Date.parse(normalizeAppointmentAt(r.end_at))
    return Number.isNaN(e) ? start(r) + 3600_000 : e
  }
  const [sa, ea, sb, eb] = [start(a), end(a), start(b), end(b)]
  if ([sa, ea, sb, eb].some(Number.isNaN)) return false
  return sa < eb && sb < ea
}

export function findDuplicates(db: DatabaseSync): DuplicatePair[] {
  const rows = db.prepare(`
    SELECT a.id, a.selection_id, a.at, a.end_at, a.kind, a.title, a.url, a.person, a.status,
           a.created_at, a.external_id, a.calendar_id,
           CASE WHEN c.short_name <> '' THEN c.short_name ELSE c.name END AS company
    FROM appointment a
    JOIN selection s ON s.id = a.selection_id
    JOIN company c ON c.id = s.company_id
    ORDER BY a.at, a.id
  `).all() as unknown as Row[]

  const pairs: DuplicatePair[] = []
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i]
      const b = rows[j]
      if (a.selection_id !== b.selection_id) continue
      const [keep, drop] = preferKeep(a, b)
      if (sameAppointment(a, b)) {
        // 突合規則で同一と判定される = 現行コードなら1行に収束したはずの組
        const why = normalizeAppointmentUrl(a.url) !== '' && normalizeAppointmentUrl(a.url) === normalizeAppointmentUrl(b.url)
          ? '同一トラック・同一開始時刻・同一URL'
          : a.title.trim() === b.title.trim()
            ? '同一トラック・同一開始時刻・同一タイトル'
            : '同一トラック・同一開始時刻・同一種別(片方のみURLあり)'
        pairs.push({
          keepId: keep.id, dropId: drop.id, company: a.company, at: a.at,
          reason: why, confidence: '確定', keep: label(keep), drop: label(drop),
        })
        continue
      }
      // 規則では別物だが、同じ日に時間帯が重なる同種の予定は人手で見る価値がある
      // (例: 同じインターン初日が開始時刻違い(11:00と13:00)で2行になっている)
      if (a.kind === b.kind && a.kind !== '締切' && overlaps(a, b)) {
        pairs.push({
          keepId: keep.id, dropId: drop.id, company: a.company, at: a.at,
          reason: '同一トラック・同一種別で時間帯が重なる(開始時刻違い)',
          confidence: '要確認', keep: label(keep), drop: label(drop),
        })
      }
    }
  }
  return pairs
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && currentFile === resolve(process.argv[1])) {
  // 読み取り専用で開く。点検が正本DBを書き換えることは絶対にない
  const db = new DatabaseSync(DB_PATH, { readOnly: true })
  const pairs = findDuplicates(db)
  if (AS_JSON) {
    console.log(JSON.stringify(pairs, null, 2))
  } else if (pairs.length === 0) {
    console.log('重複した予定は見つかりませんでした')
  } else {
    console.log(`重複候補 ${pairs.length}組(DBは書き換えていません)\n`)
    for (const p of pairs) {
      console.log(`[${p.confidence}] ${p.company} ${p.at}`)
      console.log(`  根拠: ${p.reason}`)
      if (p.confidence === '確定') {
        console.log(`  残す: ${p.keep}`)
        console.log(`  重複: ${p.drop}`)
        console.log(`  掃除する場合(本人承認のうえ別途): appointment id=${p.dropId} を削除、id=${p.keepId} を残す`)
      } else {
        // 突合規則では別物。どちらが正しいかは中身を見ないと決まらないので機械では選ばない
        console.log(`  A: ${p.keep}`)
        console.log(`  B: ${p.drop}`)
        console.log('  本人判断: どちらの内容が正しいかを見て決める(自動では選ばない)')
      }
      console.log('')
    }
  }
  db.close()
}
