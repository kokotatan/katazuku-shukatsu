// 予定IDから開始・終了時刻を引く。record-vac.ps1 が -StartIso 省略時の補完に使う。
//
// なぜ独立した .mjs か(2026-08-17): record-vac.ps1 から `node -e "..."` を直に叩くと、
// PowerShell 5.1 が引用符とバックスラッシュを食ってSQL文が壊れる。スクリプトをファイルに
// 置いて引数だけ渡す形にすれば、呼び手のクォート事情から切り離せる。
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const id = Number(process.argv[2]);
if (!Number.isInteger(id) || id <= 0) {
  console.error("usage: node appointment-times.mjs <appointmentId>");
  process.exit(2);
}

const repo = path.resolve(import.meta.dirname, "..");
// KATAZUKU_DB での上書きはOSS版と揃えるため(パス一致が subtree 同期の前提)。
const dbPath = process.env.KATAZUKU_DB ?? path.join(repo, "data", "katazuku.db");

let db;
try {
  db = new DatabaseSync(dbPath, { readOnly: true });
} catch (e) {
  console.error(`DBを開けない: ${dbPath}: ${e.message}`);
  process.exit(3);
}

const row = db.prepare("select at, end_at from appointment where id = ?").get(id);
if (!row) {
  console.error(`予定 ${id} がDBに無い`);
  process.exit(4);
}

console.log(JSON.stringify({ startIso: row.at ?? "", endIso: row.end_at ?? "" }));
