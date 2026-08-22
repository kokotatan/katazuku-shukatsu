#!/usr/bin/env node
/**
 * backup: 正本SQLiteを単一ファイルへ安全に退避する(VACUUM INTO)。
 * WAL を畳んだ1ファイルになるので、そのまま別デバイスへ移送・保管できる。
 *
 *   node tools/backup.mjs [src] [dest]
 *   npm run backup                       # OSのユーザーデータ領域から backup/ へ
 *   npm run backup -- ./my.db ./out.db   # 明示指定
 */
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveDatabasePath } from '../src/data-path.js'

const src = resolveDatabasePath(process.argv[2])
if (!existsSync(src)) {
  console.error(`正本が見つかりません: ${src}\n  src を引数または KATAZUKU_DB で指定してください。`)
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
