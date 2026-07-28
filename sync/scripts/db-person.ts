/**
 * 人物マスタの点検と重複統合。
 *   cd sync && npx tsx scripts/db-person.ts list [検索語]     … 人物一覧(メモ数・写真有無つき)
 *   cd sync && npx tsx scripts/db-person.ts merge <from> <to> … fromの人物をtoへ統合して削除
 * merge は person_note / appointment_person / person_photo を to へ付け替え、
 * role等の空欄は from の値で補完する(既存値は上書きしない)。
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { openDb } from '../src/db'

const DB_PATH = process.env.KATAZUKU_DB ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'katazuku.db')
const db = openDb(DB_PATH)
const [cmd, a1, a2] = process.argv.slice(2)

type Row = Record<string, unknown>

if (cmd === 'note') {
  const id = Number(a1)
  if (!Number.isInteger(id) || !a2) {
    console.error('usage: db-person.ts note <id> <follow_upに設定する文>')
    process.exit(1)
  }
  const r = db.prepare("UPDATE person SET follow_up = ?, updated_at = datetime('now') WHERE id = ?").run(a2, id)
  console.log(r.changes ? `follow_up設定: #${id}` : `人物が見つかりません: #${id}`)
} else if (cmd === 'merge') {
  const from = Number(a1)
  const to = Number(a2)
  if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) {
    console.error('usage: db-person.ts merge <fromId> <toId>')
    process.exit(1)
  }
  const pf = db.prepare('SELECT * FROM person WHERE id = ?').get(from) as Row | undefined
  const pt = db.prepare('SELECT * FROM person WHERE id = ?').get(to) as Row | undefined
  if (!pf || !pt) {
    console.error(`人物が見つかりません: from=${from}(${pf ? 'あり' : 'なし'}) to=${to}(${pt ? 'あり' : 'なし'})`)
    process.exit(1)
  }
  db.exec('BEGIN')
  try {
    // メモ: UNIQUE(person_id, note, source_ref) 衝突は既に同内容なので破棄でよい
    db.prepare('UPDATE OR IGNORE person_note SET person_id = ? WHERE person_id = ?').run(to, from)
    db.prepare('DELETE FROM person_note WHERE person_id = ?').run(from)
    db.prepare('UPDATE OR IGNORE appointment_person SET person_id = ? WHERE person_id = ?').run(to, from)
    db.prepare('DELETE FROM appointment_person WHERE person_id = ?').run(from)
    // 写真: to に無いときだけ from の写真を引き継ぐ
    const photoTo = db.prepare('SELECT 1 FROM person_photo WHERE person_id = ?').get(to)
    if (photoTo) {
      db.prepare('DELETE FROM person_photo WHERE person_id = ?').run(from)
    } else {
      db.prepare('UPDATE person_photo SET person_id = ? WHERE person_id = ?').run(to, from)
    }
    // 空欄補完(既存値優先)
    for (const col of ['role', 'category', 'met_at', 'how_met', 'follow_up', 'company_text']) {
      if (!pt[col] && pf[col]) db.prepare(`UPDATE person SET ${col} = ? WHERE id = ?`).run(pf[col], to)
    }
    if (!pt.company_id && pf.company_id) {
      db.prepare('UPDATE person SET company_id = ? WHERE id = ?').run(pf.company_id, to)
    }
    db.prepare("UPDATE person SET updated_at = datetime('now') WHERE id = ?").run(to)
    db.prepare('DELETE FROM person WHERE id = ?').run(from)
    db.exec('COMMIT')
    console.log(`統合完了: ${pf.name}(id=${from}) -> ${pt.name}(id=${to})`)
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
} else {
  const q = cmd === 'list' ? a1 : cmd
  const rows = db.prepare(`
    SELECT p.id, p.name, p.company_text, c.name company, p.role, p.category, p.met_at, p.updated_at,
           (SELECT COUNT(*) FROM person_note n WHERE n.person_id = p.id) notes,
           (SELECT COUNT(*) FROM appointment_person ap WHERE ap.person_id = p.id) appts,
           CASE WHEN EXISTS (SELECT 1 FROM person_photo ph WHERE ph.person_id = p.id) THEN '写真あり' ELSE '写真なし' END photo
    FROM person p LEFT JOIN company c ON c.id = p.company_id
    ${q ? "WHERE p.name LIKE '%' || ? || '%' OR c.name LIKE '%' || ? || '%'" : ''}
    ORDER BY COALESCE(c.name, p.company_text), p.name, p.id
  `).all(...(q ? [q, q] : [])) as Row[]
  for (const r of rows) {
    console.log(`#${r.id} ${r.name} | ${r.company ?? r.company_text ?? '-'} | ${r.role || '-'} | メモ${r.notes} 予定${r.appts} ${r.photo} | ${r.met_at || ''}`)
  }
  console.log(`--- ${rows.length}人`)
}
