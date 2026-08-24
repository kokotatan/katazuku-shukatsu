/**
 * 名寄せの学習CLI。本人確認の結果をDBに教える。
 *
 *   npx tsx scripts/db-alias.ts list                        # 未解決の要確認と学習済み別名を表示
 *   npx tsx scripts/db-alias.ts add <別名> <通称>            # 「別名は同じ会社」と学習
 *   npx tsx scripts/db-alias.ts new <名前>                  # 「これは別会社」と確定(新企業として登録)
 *   npx tsx scripts/db-alias.ts official <通称> <正式名称>   # 正式名称(株式会社/Inc.付き)を設定
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { openDb, addAlias, addPending, listPending, upsertCompany, resolveCompany, setOfficialName } from '../src/db'
import { resolveDatabasePath } from '../src/database-path'

const DB_PATH = resolveDatabasePath()
const db = openDb(DB_PATH)
const [cmd, a, b] = process.argv.slice(2)

if (cmd === 'add' && a && b) {
  const cid = addAlias(db, a, b)
  console.log(`学習しました: 「${a}」=「${b}」(company_id=${cid})。以降は自動で名寄せされます`)
} else if (cmd === 'new' && a) {
  const r = resolveCompany(db, a)
  if (r.kind === 'hit') {
    console.log(`既に同名の企業があります(id=${r.companyId})`)
  } else {
    const cid = upsertCompany(db, { name: a })
    db.prepare('UPDATE pending_review SET resolved = 1 WHERE name = ?').run(a)
    console.log(`別会社として登録しました: ${a} (company_id=${cid})`)
  }
} else if (cmd === 'official' && a && b) {
  setOfficialName(db, a, b)
  console.log(`正式名称を設定しました: ${a} = ${b}`)
} else if (cmd === 'list' || !cmd) {
  const pend = listPending(db)
  console.log(`未解決の名寄せ確認: ${pend.length}件`)
  for (const p of pend) console.log(`  - ${p.name}: ${p.context}`)
  const aliases = db.prepare('SELECT a.alias, c.name FROM company_alias a JOIN company c ON c.id = a.company_id ORDER BY a.rowid').all() as { alias: string; name: string }[]
  console.log(`学習済み別名: ${aliases.length}件`)
  for (const al of aliases) console.log(`  - ${al.alias} = ${al.name}`)
} else {
  console.error('使い方: db-alias.ts list | add <別名> <通称> | new <名前> | official <通称> <正式名称>')
  process.exit(1)
}

// listでの副作用なし。addPendingはexport確認用に参照(未使用警告避け)
void addPending
