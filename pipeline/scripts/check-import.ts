/**
 * 選考管理シート取込(lib/importer.ts)の動作チェック。
 * 実データ sheet-import-*.json を初期9社のボードにマージして検証する。
 * 実行: cd pipeline && npx tsx scripts/check-import.ts
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mergeImport, sameCompany } from '../src/lib/importer'
import { makeInitialCompanies } from '../src/lib/demo'
import { STAGES } from '../src/types'

let failed = 0
function check(label: string, cond: boolean, detail = '') {
  console.log(`${cond ? '✅' : '❌'} ${label}${cond ? '' : ` — ${detail}`}`)
  if (!cond) failed++
}

// --- 単体: 同一企業判定 ---
check('表記ゆれは同一視', sameCompany('株式会社サンプル', 'サンプル'))
check('短い名前は完全一致のみ(Go≠Google)', !sameCompany('Go', 'Google'))
check('ソニーグループ=ソニー株式会社', sameCompany('ソニーグループ', 'ソニー株式会社'))
check('三井物産≠三井不動産', !sameCompany('三井物産', '三井不動産'))

// --- 実データ: シート取込ファイルをボードにマージ ---
const dir = dirname(fileURLToPath(import.meta.url))
const data: { name: string }[] = JSON.parse(
  readFileSync(join(dir, '..', 'sheet-import-2026-06-12.json'), 'utf8'),
)

// 取込ファイル内に互いにマージされてしまうペアがないか(1社=1カードの前提が崩れる)
const collisions: string[] = []
for (let i = 0; i < data.length; i++) {
  for (let j = i + 1; j < data.length; j++) {
    if (sameCompany(data[i].name, data[j].name)) collisions.push(`${data[i].name} ↔ ${data[j].name}`)
  }
}
check('取込ファイル内に名寄せ衝突なし', collisions.length === 0, collisions.join(', '))

const board = makeInitialCompanies()
const result = mergeImport(board, data)

const validStages = new Set(STAGES.map((s) => s.key))
check('全カードのステージが妥当', result.companies.every((c) => validStages.has(c.stage)))

// 既存9社のうちシートにも載っている社(LayerX・タイミー・博報堂・ソニー)は更新扱いになる
const layerx = result.companies.filter((c) => sameCompany(c.name, 'LayerX'))
check('LayerXが重複しない', layerx.length === 1)
check('既存LayerXのステージ(task)を維持', layerx[0].stage === 'task')
check('既存LayerXの期限を維持', layerx[0].nextDate === '2026-06-29')
check('LayerXに業界が補完される', layerx[0].industry === 'IT・通信')

const sony = result.companies.filter((c) => sameCompany(c.name, 'ソニーグループ'))
check('ソニーが重複しない', sony.length === 1)

check(
  '追加+既存 = 取込後の総数',
  result.companies.length === board.length + result.added,
  `board=${board.length} added=${result.added} total=${result.companies.length}`,
)
console.log(
  `\n取込結果: 新規 ${result.added}社 / 既存補完 ${result.enriched}社 / 合計 ${result.companies.length}社`,
)
for (const s of STAGES) {
  console.log(`  ${s.icon} ${s.label}: ${result.companies.filter((c) => c.stage === s.key).length}社`)
}

if (failed) {
  console.error(`\n${failed}件失敗`)
  process.exit(1)
}
console.log('\nすべて通過 🎉')
