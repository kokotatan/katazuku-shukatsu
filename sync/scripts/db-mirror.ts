/**
 * 正本DB → シートへの一方向ミラー用の値を生成する。
 * シートAPIの認証はここでは扱わない。生成した mirror-out.json を、
 * agent(daily-sync内のclaude / 対話セッション)が google-workspace MCP の
 * modify_sheet_values でそのまま書き込む(rangeとvaluesを渡すだけ)。
 *
 * 実行: cd sync && npx tsx scripts/db-mirror.ts
 * 出力: <repo>/mirror-out.json (gitignore済)
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { openDb, listSelections, listCompanies } from '../src/db'

export const SHEET_ID = '1jf6kSy7tZqakw8QocOmMzU6WToncQVQCeIuQ1VfRjMM'
// タブ名(シート側をリネームしたらここを合わせる)
export const TAB_SELECTIONS = '選考管理（新）'
export const TAB_COMPANIES = '企業マスタ（新）'
const SELECTION_ROWS = 200 // 前回より行が減ったときに残骸を消すための固定の高さ
const COMPANY_ROWS = 100

export interface MirrorWrite {
  tab: string
  range: string
  values: string[][]
}

/** USER_ENTEREDで書くため、データ由来の値が数式として解釈されないようにする(唯一の数式はL列で自前生成) */
function esc(v: string): string {
  return /^[=+]/.test(v) ? `'${v}` : v
}

export function renderMirror(db: DatabaseSync): MirrorWrite[] {
  const selHeader = ['企業名', '時期', 'ポジション', '志望度', 'ステータス', '選考①', '選考②', '選考③', '選考④', '次アクション', '締切・選考日', '残り日数', '提出済', 'ES・資料URL', '選考メモ']
  const selRows: string[][] = listSelections(db).map((s, i) => {
    const r = i + 2 // シート上の行番号(1=ヘッダ)
    return [
      esc(s.company), esc(s.season), esc(s.position), esc(s.priority), esc(s.status),
      esc(s.steps[0] ?? ''), esc(s.steps[1] ?? ''), esc(s.steps[2] ?? ''), esc(s.steps[3] ?? ''),
      esc(s.nextAction), esc(s.nextDate.replace(/-/g, '/')),
      `=ifs($K${r}-today()>0,ifs($M${r}=false,"残り"&$K${r}-today()&"日",$M${r}=true,"Done"),$K${r}-today()<1,"")`,
      s.submitted ? 'TRUE' : 'FALSE', esc(s.esUrl), esc(s.memo),
    ]
  })
  while (selRows.length < SELECTION_ROWS) selRows.push(Array(selHeader.length).fill(''))

  const coHeader = ['企業名', '正式名称', '業界', 'マイページURL', 'ログインID', 'パスワード', '会社メモ']
  const coRows: string[][] = listCompanies(db).map((c) => [esc(c.name), esc(c.officialName ?? ''), esc(c.industry), esc(c.mypageUrl), esc(c.loginId), esc(c.password), esc(c.memo)])
  while (coRows.length < COMPANY_ROWS) coRows.push(Array(coHeader.length).fill(''))

  // MCPの1回の書き込みが巨大になりすぎないよう50行ずつに分割する
  const chunk = (tab: string, lastCol: string, all: string[][]): MirrorWrite[] => {
    const out: MirrorWrite[] = []
    for (let i = 0; i < all.length; i += 50) {
      const part = all.slice(i, i + 50)
      out.push({ tab, range: `A${i + 1}:${lastCol}${i + part.length}`, values: part })
    }
    return out
  }
  return [
    ...chunk(TAB_SELECTIONS, 'O', [selHeader, ...selRows]),
    ...chunk(TAB_COMPANIES, 'G', [coHeader, ...coRows]),
  ]
}

const invokedDirectly =
  process.argv[1] != null &&
  resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()

if (invokedDirectly) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const DB_PATH = process.env.KATAZUKU_DB ?? join(root, 'data', 'katazuku.db')
  const db = openDb(DB_PATH)
  const writes = renderMirror(db)
  const out = join(root, 'mirror-out.json')
  writeFileSync(out, JSON.stringify({ sheetId: SHEET_ID, writes }, null, 1), 'utf8')
  const perTab = new Map<string, number>()
  for (const w of writes) {
    const n = w.values.filter((v, i) => v[0] && !(w.range.startsWith('A1:') && i === 0)).length
    perTab.set(w.tab, (perTab.get(w.tab) ?? 0) + n)
  }
  const filled = [...perTab].map(([t, n]) => `${t}: ${n}行`).join(' / ')
  console.log(`ミラー生成: ${filled} (${writes.length}チャンク) -> ${out}`)
}
