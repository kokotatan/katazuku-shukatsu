/**
 * 前夜ブリーフ用データ集約: 指定日(既定=明日JST)の面接・面談・説明会・テスト予定について、
 * 会社・選考状況・相手(人物表+メモ)・過去の面接記録・直近イベントをJSONで出力する。
 *   cd sync && npx tsx scripts/brief-data.ts [YYYY-MM-DD]
 * 出力はstdoutのJSONのみ(evening-briefプロンプトが読む)。個人データを含むためファイルへは書かない。
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { openDb } from '../src/db'

const DB_PATH = process.env.KATAZUKU_DB ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'katazuku.db')
const db = openDb(DB_PATH)

function jstDate(offsetDays: number): string {
  const d = new Date(Date.now() + 9 * 3600_000 + offsetDays * 86400_000)
  return d.toISOString().slice(0, 10)
}
const date = process.argv[2] ?? jstDate(1)

type Row = Record<string, unknown>

const appts = db.prepare(`
  SELECT a.id, a.at, a.kind, a.title, a.url, a.location, a.person, a.status,
         s.id selection_id, s.position, s.status selection_status, s.next_action, s.memo selection_memo,
         c.id company_id, c.name company, c.industry, c.mypage_url, c.memo company_memo
  FROM appointment a
  JOIN selection s ON s.id = a.selection_id
  JOIN company c ON c.id = s.company_id
  WHERE a.at LIKE ? || '%' AND a.status = '予定'
    AND a.kind IN ('面接', '面談', '説明会', 'テスト')
  ORDER BY a.at
`).all(date) as Row[]

const out = appts.map((a) => {
  const linkedPeople = db.prepare(`
    SELECT p.id, p.name, p.role, p.category, p.met_at, p.how_met, ap.role appointment_role
    FROM appointment_person ap JOIN person p ON p.id = ap.person_id
    WHERE ap.appointment_id = ?
  `).all(a.id) as Row[]
  const companyPeople = db.prepare(`
    SELECT p.id, p.name, p.role, p.category, p.met_at, p.how_met
    FROM person p WHERE p.company_id = ? ORDER BY p.updated_at DESC LIMIT 10
  `).all(a.company_id) as Row[]
  const withNotes = (people: Row[]) => people.map((p) => ({
    ...p,
    notes: (db.prepare(`
      SELECT at, note, confidence FROM person_note WHERE person_id = ? ORDER BY at DESC LIMIT 5
    `).all(p.id) as Row[]),
  }))
  const pastInterviews = db.prepare(`
    SELECT occurred_at, title, summary, transcript_path
    FROM interview_note WHERE company_id = ? ORDER BY occurred_at DESC LIMIT 5
  `).all(a.company_id) as Row[]
  const recentEvents = db.prepare(`
    SELECT at, kind, summary FROM event WHERE selection_id = ? ORDER BY at DESC LIMIT 8
  `).all(a.selection_id) as Row[]
  return {
    ...a,
    linkedPeople: withNotes(linkedPeople),
    companyPeople: withNotes(companyPeople),
    pastInterviews,
    recentEvents,
  }
})

console.log(JSON.stringify({ date, count: out.length, appointments: out }, null, 1))
