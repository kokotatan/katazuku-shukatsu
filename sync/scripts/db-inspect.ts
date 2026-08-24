/** 正本DBの中身をざっと確認する(名寄せの誤マージ検査にも使う)。cd sync && npx tsx scripts/db-inspect.ts [検索語] */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { openDb } from '../src/db'
import { resolveDatabasePath } from '../src/database-path'

const DB_PATH = resolveDatabasePath()
const db = openDb(DB_PATH)
const q = process.argv[2]

const rows = db.prepare(`
  SELECT c.name co, s.season, s.position, s.status
  FROM selection s JOIN company c ON c.id = s.company_id
  ${q ? "WHERE c.name LIKE '%' || ? || '%'" : ''}
  ORDER BY c.name, s.id
`).all(...(q ? [q] : [])) as { co: string; season: string; position: string; status: string }[]

for (const r of rows) console.log(`${r.co} | ${r.season} | ${r.position || '-'} | ${r.status}`)
console.log(`--- ${rows.length}行`)

const cos = db.prepare('SELECT name FROM company ORDER BY name').all() as { name: string }[]
if (!q) console.log('\n企業(' + cos.length + '): ' + cos.map((c) => c.name).join(' / '))
