/**
 * katazuku 正本DB(ローカルSQLite・node:sqlite標準モジュール・依存ゼロ)。
 *
 * 方針(docs/specs/08-data.md 2026-07-18改訂 + 同日のレビュー修正):
 * - 正本はこのDB1つ。シート・管理画面・カレンダーは「見る窓」(DB→一方向ミラー)
 * - 書き手はagentだけ(メール→DB、本人の指示→DB)。人はシートを直接編集しない
 * - だから「上書きしない」ではなく「遷移規則で堂々と更新する」(transition() に集約)
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export interface Selection {
  id?: number
  company: string
  season: string      // 夏 / 冬 / 本選考 / 春 / 長期
  position: string
  priority: string
  status: string      // 自由記述(「人事面接済(7/16)」等)
  steps: string[]     // 選考①〜④
  nextAction: string
  nextDate: string    // YYYY-MM-DD or ''
  submitted: boolean
  esUrl: string
  memo: string
}

export interface CompanyInfo {
  name: string
  industry: string
  mypageUrl: string
  loginId: string
  password: string
  memo: string
}

export function openDb(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS company (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      industry TEXT NOT NULL DEFAULT '',
      mypage_url TEXT NOT NULL DEFAULT '',
      login_id TEXT NOT NULL DEFAULT '',
      password TEXT NOT NULL DEFAULT '',
      memo TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS selection (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES company(id),
      season TEXT NOT NULL DEFAULT '',
      position TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      step1 TEXT NOT NULL DEFAULT '',
      step2 TEXT NOT NULL DEFAULT '',
      step3 TEXT NOT NULL DEFAULT '',
      step4 TEXT NOT NULL DEFAULT '',
      next_action TEXT NOT NULL DEFAULT '',
      next_date TEXT NOT NULL DEFAULT '',
      submitted INTEGER NOT NULL DEFAULT 0,
      es_url TEXT NOT NULL DEFAULT '',
      memo TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL DEFAULT 'agent'
    );
  `)
  return db
}

// ---- 名寄せ(sheet.tsと同一規則) ----

function normalize(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/株式会社|合同会社|有限会社|\(株\)/g, '')
    .replace(/[()\s　]/g, '')
}

export function sameCompany(a: string, b: string): boolean {
  const na = normalize(a)
  const nb = normalize(b)
  // 部分一致は両方4文字以上のときだけ(「トヨタ」⊂「トヨタ・コニック・プロ」の誤マージを防ぐ)
  if (na.length < 4 || nb.length < 4) return na === nb
  return na.includes(nb) || nb.includes(na)
}

// ---- ステータス遷移規則(specの「書き込みモデル」) ----

export type Stage = 'scouted' | 'entried' | 'task' | 'interview' | 'intern' | 'offer' | 'rejected' | 'closed'

export const STATUS_FOR: Record<Stage, string> = {
  scouted: '出願予定',
  entried: '出願済',
  task: '出願済',
  interview: '選考中',
  intern: '合格',
  offer: '内定',
  rejected: '不合格',
  closed: '辞退',
}

/** ポジション(トラック)の同一判定。企業名の部分一致規則は流用せず、正規化後の完全一致のみ */
export function samePosition(a: string, b: string): boolean {
  return normalize(a) === normalize(b)
}

/** 終了系(不合格・辞退など)。復活させない */
const FINAL_NEG = /不合格|辞退|欠席|振替不可|お見送り|見送り|実質終了/
/** 確定ポジティブ(合格・参加・内定)。「不合格」の部分一致を除いて判定 */
function isFinalPos(s: string): boolean {
  return /合格|参加確定|参加済|内定|参加した/.test(s.replace(/不合格/g, ''))
}

function rank(status: string): number {
  if (!status.trim()) return 0
  if (FINAL_NEG.test(status)) return 4
  if (isFinalPos(status)) return 3
  if (/出願予定|検討/.test(status)) return 1
  return 2 // 出願済・選考中・自由記述の進行中(「人事面接済(7/16)」等)
}

/**
 * メール根拠の新情報(stage)で現ステータスをどう更新するか。
 * 返り値: 書き込むべき新ステータス / null = 触らない。
 * - 終了系(不合格・辞退)は根拠があれば合格からでも確定できる(八洲問題の解消)。不合格と辞退は別語で書く
 * - 終了系からの復活はさせない
 * - 内定は終了系以外のすべてを上書きできる(「面接合格」等の途中経過に含まれる「合格」で弾かない)
 * - 進行中の自由記述(詳しい手書きステータス)は、粗い「出願済」等で潰さない
 */
export function transition(current: string, stage: Stage): string | null {
  const want = STATUS_FOR[stage]
  const cur = current.trim()
  if (cur === want) return null
  if (FINAL_NEG.test(cur)) return null // 終了済は動かさない
  if (stage === 'closed' || stage === 'rejected') return want // 終了の根拠は最優先で確定
  if (stage === 'offer') return want // 内定の根拠は途中経過の「合格」表記に関係なく確定
  if (stage === 'intern') {
    return isFinalPos(cur) ? null : want // 合格の根拠は進行中を確定に進める
  }
  // 進行中系(scouted〜interview)は、空欄 or より浅いランクのときだけ前進
  return rank(cur) < rank(want) ? want : null
}

// ---- 読み書きヘルパー ----

export function upsertCompany(db: DatabaseSync, info: Partial<CompanyInfo> & { name: string }): number {
  const now = new Date().toISOString()
  const all = db.prepare('SELECT id, name FROM company').all() as { id: number; name: string }[]
  const hit = all.find((r) => sameCompany(r.name, info.name))
  if (hit) {
    // 空欄だけ補完(会社情報は安定情報。名寄せ済みの別表記で上書きしない)
    const cur = db.prepare('SELECT * FROM company WHERE id = ?').get(hit.id) as Record<string, unknown>
    const fill = (col: string, v?: string) => {
      if (v && !(cur[col] as string)) db.prepare(`UPDATE company SET ${col} = ?, updated_at = ? WHERE id = ?`).run(v, now, hit.id)
    }
    fill('industry', info.industry)
    fill('mypage_url', info.mypageUrl)
    fill('login_id', info.loginId)
    fill('password', info.password)
    fill('memo', info.memo)
    return hit.id
  }
  const r = db.prepare(
    'INSERT INTO company (name, industry, mypage_url, login_id, password, memo, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(info.name, info.industry ?? '', info.mypageUrl ?? '', info.loginId ?? '', info.password ?? '', info.memo ?? '', now)
  return Number(r.lastInsertRowid)
}

export function insertSelection(db: DatabaseSync, companyId: number, s: Selection, by = 'agent'): number {
  const now = new Date().toISOString()
  const r = db.prepare(`
    INSERT INTO selection (company_id, season, position, priority, status, step1, step2, step3, step4,
      next_action, next_date, submitted, es_url, memo, updated_at, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    companyId, s.season, s.position, s.priority, s.status,
    s.steps[0] ?? '', s.steps[1] ?? '', s.steps[2] ?? '', s.steps[3] ?? '',
    s.nextAction, s.nextDate, s.submitted ? 1 : 0, s.esUrl, s.memo, now, by,
  )
  return Number(r.lastInsertRowid)
}

export interface SelectionRow extends Selection {
  id: number
  companyId: number
}

export function listSelections(db: DatabaseSync): SelectionRow[] {
  const rows = db.prepare(`
    SELECT s.id, s.company_id, c.name, s.season, s.position, s.priority, s.status,
           s.step1, s.step2, s.step3, s.step4, s.next_action, s.next_date, s.submitted, s.es_url, s.memo
    FROM selection s JOIN company c ON c.id = s.company_id
    ORDER BY s.id
  `).all() as Record<string, unknown>[]
  return rows.map((r) => ({
    id: r.id as number,
    companyId: r.company_id as number,
    company: r.name as string,
    season: r.season as string,
    position: r.position as string,
    priority: r.priority as string,
    status: r.status as string,
    steps: [r.step1, r.step2, r.step3, r.step4].map((v) => (v as string) ?? '').filter(Boolean),
    nextAction: r.next_action as string,
    nextDate: r.next_date as string,
    submitted: (r.submitted as number) === 1,
    esUrl: r.es_url as string,
    memo: r.memo as string,
  }))
}

export function listCompanies(db: DatabaseSync): CompanyInfo[] {
  const rows = db.prepare('SELECT * FROM company ORDER BY id').all() as Record<string, unknown>[]
  return rows.map((r) => ({
    name: r.name as string,
    industry: r.industry as string,
    mypageUrl: r.mypage_url as string,
    loginId: r.login_id as string,
    password: r.password as string,
    memo: r.memo as string,
  }))
}
