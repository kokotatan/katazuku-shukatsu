import type { Company, Stage } from '../types'
import { sameCompany } from './importer'

/**
 * 選考管理シート(Googleスプレッドシート)への書き戻し。
 * ボードを正として、シート側の 出願状況/次回アクション/〆切 を更新し、
 * シートに無い企業は表の空き行に追記する。
 *
 * 安全ルール:
 * - 合格/不合格/辞退 などの最終状態は上書きしない(合格の自動集計が壊れるため)
 * - メモ欄・選考①〜④・提出済(チェック)・残り日数(数式)には一切触れない
 * - 業界・志望度はシート側が空欄のときだけ補完する
 */

export const DEFAULT_SHEET_ID = '1X6z04LUU5IHvzJLoKQiHpdc_ml21Dor3XDDdz9rWLx0'

export interface SheetTable {
  /** 「企業名」ヘッダ行 (0-based) */
  headerRow: number
  /** データ範囲の終端 (exclusive)。次の表のヘッダ or シート末尾 */
  endRow: number
  cols: {
    name: number
    industry: number
    priority: number
    status: number
    nextAction: number
    nextDate: number
  }
}

export interface CellUpdate {
  /** 0-based */
  row: number
  /** 0-based */
  col: number
  value: string
}

export interface SyncPlan {
  updates: CellUpdate[]
  updatedNames: string[]
  addedNames: string[]
  /** 空き行が足りず追記できなかった企業 */
  skipped: string[]
}

export function locateTable(rows: string[][]): SheetTable | null {
  const headerRow = rows.findIndex((r) => r.some((c) => c === '企業名'))
  if (headerRow === -1) return null
  const header = rows[headerRow]
  const cols = {
    name: header.findIndex((c) => c === '企業名'),
    industry: header.findIndex((c) => c === '業界'),
    priority: header.findIndex((c) => c === '志望度'),
    status: header.findIndex((c) => c === '出願状況'),
    nextAction: header.findIndex((c) => c.includes('次回アクション')),
    nextDate: header.findIndex((c) => c.includes('〆切')),
  }
  if (cols.status === -1) return null
  let endRow = rows.length
  for (let i = headerRow + 1; i < rows.length; i++) {
    if (rows[i].some((c) => c === '企業名')) {
      endRow = i
      break
    }
  }
  return { headerRow, endRow, cols }
}

const STATUS_FOR: Record<Stage, string> = {
  scouted: '出願予定',
  entried: '出願済',
  task: '出願済',
  interview: '出願済',
  intern: '合格',
  offer: '合格',
  closed: '辞退',
}

// 進行度。最終状態(3)同士の書き換えや後退方向の上書きはしない
const RANK: Record<string, number> = {
  '': 0,
  出願予定: 1,
  出願済: 2,
  補欠: 2,
  合格: 3,
  不合格: 3,
  辞退: 3,
}

export function desiredStatus(stage: Stage, current: string): string | null {
  const want = STATUS_FOR[stage]
  if (want === current) return null
  if ((RANK[current] ?? 0) >= (RANK[want] ?? 0)) return null
  return want
}

/** シート上の日付表記(「6/15」「2026/6/15」等)がボードの YYYY-MM-DD と同じ日か */
function sameDate(sheetVal: string, iso: string): boolean {
  const m = sheetVal.match(/(?:(\d{4})[/年.-])?(\d{1,2})[/月.-](\d{1,2})/)
  if (!m) return false
  const y = m[1] ? Number(m[1]) : Number(iso.slice(0, 4))
  return iso === `${y}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`
}

export function planUpdates(companies: Company[], rows: string[][], table: SheetTable): SyncPlan {
  const { headerRow, endRow, cols } = table
  const cell = (r: number, c: number) => (c >= 0 ? (rows[r]?.[c] ?? '').trim() : '')
  const dataStart = headerRow + 1

  const blanks: number[] = []
  for (let r = dataStart; r < endRow; r++) {
    if (!cell(r, cols.name)) blanks.push(r)
  }

  const plan: SyncPlan = { updates: [], updatedNames: [], addedNames: [], skipped: [] }

  for (const co of companies) {
    if (!co.name.trim()) continue
    let row = -1
    for (let r = dataStart; r < endRow; r++) {
      const n = cell(r, cols.name)
      if (n && sameCompany(n, co.name)) {
        row = r
        break
      }
    }

    if (row >= 0) {
      const before = plan.updates.length
      const status = desiredStatus(co.stage, cell(row, cols.status))
      if (status) plan.updates.push({ row, col: cols.status, value: status })
      if (cols.nextAction >= 0 && co.nextAction && cell(row, cols.nextAction) !== co.nextAction)
        plan.updates.push({ row, col: cols.nextAction, value: co.nextAction })
      if (cols.nextDate >= 0 && co.nextDate && !sameDate(cell(row, cols.nextDate), co.nextDate))
        plan.updates.push({ row, col: cols.nextDate, value: co.nextDate.replace(/-/g, '/') })
      if (cols.industry >= 0 && co.industry && !cell(row, cols.industry))
        plan.updates.push({ row, col: cols.industry, value: co.industry })
      if (cols.priority >= 0 && co.priority && !cell(row, cols.priority))
        plan.updates.push({ row, col: cols.priority, value: co.priority })
      if (plan.updates.length > before) plan.updatedNames.push(co.name)
    } else {
      const r = blanks.shift()
      if (r === undefined) {
        plan.skipped.push(co.name)
        continue
      }
      plan.updates.push({ row: r, col: cols.name, value: co.name })
      plan.updates.push({ row: r, col: cols.status, value: STATUS_FOR[co.stage] })
      if (cols.industry >= 0 && co.industry) plan.updates.push({ row: r, col: cols.industry, value: co.industry })
      if (cols.priority >= 0 && co.priority) plan.updates.push({ row: r, col: cols.priority, value: co.priority })
      if (cols.nextAction >= 0 && co.nextAction) plan.updates.push({ row: r, col: cols.nextAction, value: co.nextAction })
      if (cols.nextDate >= 0 && co.nextDate) plan.updates.push({ row: r, col: cols.nextDate, value: co.nextDate.replace(/-/g, '/') })
      plan.addedNames.push(co.name)
    }
  }

  return plan
}

// ---- Google Sheets API ----

const API = 'https://sheets.googleapis.com/v4/spreadsheets'

async function getJson(url: string, token: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Sheets API エラー (${res.status})`)
  return res.json()
}

export interface SheetGrid {
  tabTitle: string
  rows: string[][]
  table: SheetTable
}

/** 「企業名」列を持つタブを探してグリッドを返す */
export async function fetchGrid(token: string, spreadsheetId: string): Promise<SheetGrid> {
  const meta = (await getJson(
    `${API}/${spreadsheetId}?fields=sheets.properties.title`,
    token,
  )) as { sheets?: { properties: { title: string } }[] }

  for (const s of meta.sheets ?? []) {
    const title = s.properties.title
    const range = encodeURIComponent(`'${title}'!A1:T500`)
    const data = (await getJson(`${API}/${spreadsheetId}/values/${range}`, token)) as {
      values?: string[][]
    }
    const rows = data.values ?? []
    const table = locateTable(rows)
    if (table) return { tabTitle: title, rows, table }
  }
  throw new Error('「企業名」「出願状況」列を持つ表が見つかりませんでした')
}

function colLetter(index: number): string {
  let s = ''
  let i = index + 1
  while (i > 0) {
    const m = (i - 1) % 26
    s = String.fromCharCode(65 + m) + s
    i = Math.floor((i - 1) / 26)
  }
  return s
}

export async function applyPlan(
  token: string,
  spreadsheetId: string,
  tabTitle: string,
  updates: CellUpdate[],
): Promise<void> {
  if (updates.length === 0) return
  const res = await fetch(`${API}/${spreadsheetId}/values:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      valueInputOption: 'USER_ENTERED',
      data: updates.map((u) => ({
        range: `'${tabTitle}'!${colLetter(u.col)}${u.row + 1}`,
        values: [[u.value]],
      })),
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`書き込みに失敗しました (${res.status}): ${body.slice(0, 200)}`)
  }
}
