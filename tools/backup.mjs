#!/usr/bin/env node
/**
 * backup: 正本SQLiteを単一ファイルへ安全に退避する(VACUUM INTO)。
 * WAL を畳んだ1ファイルになるので、そのまま別デバイスへ移送・保管できる。
 *
 *   node tools/backup.mjs [src] [dest]
 *   npm run backup                       # data/katazuku.db を data/backup/ へタイムスタンプ付きで
 *   npm run backup -- ./my.db ./out.db   # 明示指定
 */
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const src = process.argv[2] ?? join('data', 'katazuku.db')
if (!existsSync(src)) {
  console.error(`正本が見つかりません: ${src}\n  src を引数で指定するか、data/katazuku.db を用意してください。`)
  process.exit(1)
}

let dest = process.argv[3]
if (!dest) {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  dest = join(dirname(src), 'backup', `katazuku-${stamp}.db`)
}
mkdirSync(dirname(dest), { recursive: true })

const db = new DatabaseSync(src)
db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`)
db.close()
console.log(`バックアップを作成しました: ${dest}`)
