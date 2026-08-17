// mirror-out.json から google-workspace MCP の modify_sheet_values 呼び出し定義を生成する。
// 巨大なvalues配列をエージェントのコンテキストに載せずにシートへミラーするための橋渡し。
//   node scripts/build-mirror-calls.mjs [mirror-out.json] [out.json]
import { readFileSync, writeFileSync } from "node:fs";

const src = process.argv[2] ?? "mirror-out.json";
const out = process.argv[3] ?? "tmp/mirror-calls.json";
const mirror = JSON.parse(readFileSync(src, "utf8"));

const calls = mirror.writes.map((w) => ({
  name: "modify_sheet_values",
  arguments: {
    spreadsheet_id: mirror.sheetId,
    range_name: `'${w.tab}'!${w.range}`,
    values: w.values.map((row) => row.map((cell) => (cell == null ? "" : String(cell)))),
    // RAWだと「残り日数」列の =ifs(...) が文字列として書き込まれ、数式が壊れる
    value_input_option: "USER_ENTERED",
    user_google_email: "okuyama.kotaro.career@gmail.com",
  },
}));

writeFileSync(out, JSON.stringify(calls, null, 2), "utf8");
console.log(`${calls.length}件の書き込み定義 -> ${out}`);
