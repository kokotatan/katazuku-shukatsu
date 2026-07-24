// 正本DBの company から「移行対象の資格情報」を1行JSONで標準出力へ出す。
//
// 【重要】この出力には平文のログインIDとパスワードが含まれる。
// - 単体で実行しない。必ず migrate-db-credentials.ps1 から呼び、変数で受けてDPAPIへ渡すこと。
// - ファイルへリダイレクトしない。ログに残さない。画面に出さない。
// - 用途は「平文DB -> DPAPI暗号化レコード」への一方向移行のみ。
//
// 対象条件: password が非空 かつ mypage_url が非空(許可originを決められる)。

import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const dbPath = process.env.KATAZUKU_DB
  ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'katazuku.db')

const db = new DatabaseSync(dbPath, { readOnly: true })
const rows = db
  .prepare("SELECT id, name, login_id, password, mypage_url FROM company WHERE password <> '' AND mypage_url <> '' ORDER BY id")
  .all()

process.stdout.write(JSON.stringify(rows.map((row) => ({
  portalId: `company-${row.id}`,
  companyId: row.id,
  name: row.name,
  username: row.login_id,
  password: row.password,
  mypageUrl: row.mypage_url
}))))
db.close()
