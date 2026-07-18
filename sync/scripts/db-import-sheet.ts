/**
 * 初期移行: シートから書き出したシードJSONを正本DBへ取り込む(1回きり/やり直し可)。
 *
 * シードJSONの形:
 *   { "selections": [{company, season, position, priority, status, steps[], nextAction,
 *                     nextDate, submitted, esUrl, memo}...],
 *     "companies":  [{name, industry, mypageUrl, loginId, password, memo}...] }
 *
 * 実行: cd sync && npx tsx scripts/db-import-sheet.ts <seed.json> [--reset]
 *   --reset で既存の全行を消してから取り込む(取り込みのやり直し用)
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { openDb, upsertCompany, insertSelection, type Selection, type CompanyInfo } from '../src/db'

const DB_PATH = process.env.KATAZUKU_DB ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'katazuku.db')

const args = process.argv.slice(2)
const seedPath = args.find((a) => !a.startsWith('--'))
if (!seedPath) {
  console.error('使い方: npx tsx scripts/db-import-sheet.ts <seed.json> [--reset]')
  process.exit(1)
}

interface Seed {
  selections: Selection[]
  companies: CompanyInfo[]
}

/** シートから読んだ生の行列(1行目=ヘッダ)を構造化する。MCPで書き出したグリッドをそのまま流し込める */
function fromGrids(selGrid: string[][], coGrid: string[][]): Seed {
  const col = (header: string[], ...names: string[]) => {
    for (const n of names) {
      const i = header.findIndex((c) => c === n || c.includes(n))
      if (i >= 0) return i
    }
    return -1
  }
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '')

  const sh = selGrid[0] ?? []
  const sc = {
    name: col(sh, '企業名'), season: col(sh, '時期'), position: col(sh, 'ポジション'),
    priority: col(sh, '志望度'), status: col(sh, 'ステータス'),
    s1: col(sh, '選考①'), s2: col(sh, '選考②'), s3: col(sh, '選考③'), s4: col(sh, '選考④'),
    nextAction: col(sh, '次アクション'), nextDate: col(sh, '締切'),
    submitted: col(sh, '提出済'), esUrl: col(sh, 'ES'), memo: col(sh, '選考メモ'),
  }
  const selections: Selection[] = selGrid.slice(1)
    .filter((r) => get(r, sc.name))
    .map((r) => ({
      company: get(r, sc.name), season: get(r, sc.season), position: get(r, sc.position),
      priority: get(r, sc.priority), status: get(r, sc.status),
      steps: [get(r, sc.s1), get(r, sc.s2), get(r, sc.s3), get(r, sc.s4)].filter(Boolean),
      nextAction: get(r, sc.nextAction),
      nextDate: get(r, sc.nextDate).replace(/\//g, '-'),
      submitted: get(r, sc.submitted).toUpperCase() === 'TRUE',
      esUrl: get(r, sc.esUrl), memo: get(r, sc.memo),
    }))

  const ch = coGrid[0] ?? []
  const cc = {
    name: col(ch, '企業名'), industry: col(ch, '業界'), mypageUrl: col(ch, 'マイページ'),
    loginId: col(ch, 'ログインID'), password: col(ch, 'パスワード'), memo: col(ch, '会社メモ'),
  }
  const companies: CompanyInfo[] = coGrid.slice(1)
    .filter((r) => get(r, cc.name))
    .map((r) => ({
      name: get(r, cc.name), industry: get(r, cc.industry), mypageUrl: get(r, cc.mypageUrl),
      loginId: get(r, cc.loginId), password: get(r, cc.password), memo: get(r, cc.memo),
    }))

  return { selections, companies }
}

const raw = JSON.parse(readFileSync(seedPath, 'utf8')) as Seed & {
  selectionsGrid?: string[][]
  companiesGrid?: string[][]
}
const seed: Seed = raw.selectionsGrid
  ? fromGrids(raw.selectionsGrid, raw.companiesGrid ?? [])
  : raw

const db = openDb(DB_PATH)
if (args.includes('--reset')) {
  db.exec('DELETE FROM selection; DELETE FROM company;')
  console.log('既存データを削除しました(--reset)')
}

for (const c of seed.companies ?? []) upsertCompany(db, c)
let n = 0
for (const s of seed.selections ?? []) {
  const cid = upsertCompany(db, { name: s.company })
  insertSelection(db, cid, s, 'import')
  n++
}
console.log(`取り込み完了: 選考 ${n}行 / 企業 ${(seed.companies ?? []).length}社 -> ${DB_PATH}`)
