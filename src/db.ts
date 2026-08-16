/**
 * katazuku 正本DB(ローカルSQLite・node:sqlite標準モジュール・依存ゼロ)。
 *
 * 方針(docs/specs/08-data.md 2026-07-18改訂 + 同日のレビュー修正):
 * - 正本はこのDB1つ。シート・管理画面・カレンダーは「見る窓」(DB→一方向ミラー)
 * - 書き手はagentだけ(メール→DB、本人の指示→DB)。人はシートを直接編集しない
 * - だから「上書きしない」ではなく「遷移規則で堂々と更新する」(transition() に集約)
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { ensurePlatformSchema } from './platform.js'

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
  /** 正式名称(株式会社/Inc.等の法人格付き)が「正」。未判明の間は現在の最良の名称 */
  name: string
  /** 通称(表示用。選考管理タブやboardで使う短い名前) */
  shortName?: string
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
    -- 名寄せの学習台帳: 別名(正規化キー) -> 正式名称の企業。本人確認を経てここに増えていく
    CREATE TABLE IF NOT EXISTS company_alias (
      alias_norm TEXT PRIMARY KEY,
      alias TEXT NOT NULL,
      company_id INTEGER NOT NULL REFERENCES company(id),
      created_at TEXT NOT NULL
    );
    -- 名寄せが怪しかった入力の待ち行列。本人に確認してから alias 登録 or 新企業として解決する
    CREATE TABLE IF NOT EXISTS pending_review (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      context TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0
    );
    -- イベント台帳(本人方針 2026-07-18「イベント起点」): 状態が変わる出来事を必ず記録し、
    -- selection.status はその結果のキャッシュとして扱う。「なぜ今この状態か」を後から追える
    CREATE TABLE IF NOT EXISTS event (
      id INTEGER PRIMARY KEY,
      selection_id INTEGER NOT NULL REFERENCES selection(id),
      at TEXT NOT NULL,
      kind TEXT NOT NULL,
      summary TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT '',
      ref TEXT NOT NULL DEFAULT ''
    );
    -- 予定(2026-07-18本人指摘「取っている情報が足りない」への回答):
    -- 面接の時刻・会議URL・場所・相手、提出物の締切を構造化して持つ。1トラックに複数持てる。
    -- kind: 面接 / 面談 / 締切 / 説明会 / テスト / その他
    CREATE TABLE IF NOT EXISTS appointment (
      id INTEGER PRIMARY KEY,
      selection_id INTEGER NOT NULL REFERENCES selection(id),
      at TEXT NOT NULL,               -- ISO日時(時刻不明なら日付のみ)
      kind TEXT NOT NULL DEFAULT 'その他',
      title TEXT NOT NULL,
      url TEXT NOT NULL DEFAULT '',   -- Meet/Zoom/提出ページ
      location TEXT NOT NULL DEFAULT '',
      person TEXT NOT NULL DEFAULT '',-- 相手(面接官等)
      status TEXT NOT NULL DEFAULT '予定',  -- 予定 / 完了 / 中止
      created_at TEXT NOT NULL
    );
  `)
  // マイグレーションに失敗したら開きっぱなしにしない。
  // 呼び手は例外で気づくが、ハンドルが残るとファイルを掴んだままになる。
  try {
    migrate(db, path)
  } catch (error) {
    db.close()
    throw error
  }
  return db
}

/** 現行スキーマの版。マイグレーションを足すたびに +1 し、`MIGRATIONS` に1本足す */
export const SCHEMA_VERSION = 2

/**
 * 版ゲート方式のマイグレーション(#10)。
 *
 * 以前は `PRAGMA table_info` の存在チェックを毎回舐める場当たり方式で、`user_version` は
 * 実質未使用だった。列の追加だけなら冪等に見えるが、列DROP・データ移送が混ざった瞬間に
 * 「どこまで適用済みか」を誰も知らない状態になる。版で束ねて、番号でしか進まないようにする。
 *
 * `destructive: true` の版は、適用前に自動でスナップショット(`VACUUM INTO`)を取る。
 * 取れなければ**適用しない**。壊れてから気づく事故より、進まない方がましなので。
 */
interface Migration {
  version: number
  description: string
  /** 列DROP・データ移送を含むか。含むなら適用前にバックアップを取る */
  destructive: boolean
  up: (db: DatabaseSync) => void
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: '正式名称を name へ、通称を short_name へ。outcome・event.ref・appointment.end_at を追加',
    // 旧 official_name 列を DROP するため破壊的
    destructive: true,
    up: (db) => {
      const cols = db.prepare('PRAGMA table_info(company)').all() as { name: string }[]
      const has = (c: string) => cols.some((x) => x.name === c)
      if (!has('short_name')) db.exec("ALTER TABLE company ADD COLUMN short_name TEXT NOT NULL DEFAULT ''")
      db.exec("UPDATE company SET short_name = name WHERE short_name = ''")
      if (has('official_name')) {
        db.exec("UPDATE company SET name = official_name WHERE official_name <> ''")
        db.exec('ALTER TABLE company DROP COLUMN official_name')
      }
      // selection.outcome: 状態の機械判定用の列挙。status は人間可読の自由文のまま
      const scols = db.prepare('PRAGMA table_info(selection)').all() as { name: string }[]
      if (!scols.some((c) => c.name === 'outcome')) {
        db.exec("ALTER TABLE selection ADD COLUMN outcome TEXT NOT NULL DEFAULT ''")
        db.exec(`UPDATE selection SET outcome = CASE
          WHEN status GLOB '*不合格*' OR status GLOB '*欠席*' OR status GLOB '*振替不可*' OR status GLOB '*見送り*' OR status GLOB '*実質終了*' THEN '不合格'
          WHEN status GLOB '*辞退*' THEN '辞退'
          WHEN status GLOB '*内定*' THEN '内定'
          WHEN REPLACE(status,'不合格','') GLOB '*合格*' OR status GLOB '*参加*' OR status GLOB '*通過*' THEN '合格'
          ELSE '進行中' END`)
      }
      const ecols = db.prepare('PRAGMA table_info(event)').all() as { name: string }[]
      if (!ecols.some((c) => c.name === 'ref')) db.exec("ALTER TABLE event ADD COLUMN ref TEXT NOT NULL DEFAULT ''")
      // appointment.end_at: 会議の終了時刻(無ければ開始+60分とみなす)
      const acols = db.prepare('PRAGMA table_info(appointment)').all() as { name: string }[]
      if (!acols.some((c) => c.name === 'end_at')) db.exec("ALTER TABLE appointment ADD COLUMN end_at TEXT NOT NULL DEFAULT ''")
    },
  },
  {
    version: 2,
    description: '人物・プロフィール・移動などの拡張スキーマ(platform)を版の管理下に入れる',
    destructive: false,
    up: (db) => ensurePlatformSchema(db),
  },
]

/** 適用前のスナップショット。`VACUUM INTO` で WAL を畳んだ1ファイルを隣に置く */
function snapshotBeforeMigration(db: DatabaseSync, path: string, version: number): string {
  const target = `${path}.v${version}.bak`
  rmSync(target, { force: true })
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
  return target
}

function migrate(db: DatabaseSync, path: string): void {
  const current = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue
    // インメモリDBはバックアップの取りようが無い(消えて困るデータも無い)ので飛ばす
    if (migration.destructive && path !== ':memory:') {
      const target = snapshotBeforeMigration(db, path, migration.version)
      console.warn(`スキーマ v${migration.version} を適用します。適用前のスナップショット: ${target}`)
    }
    migration.up(db)
    db.exec(`PRAGMA user_version = ${migration.version}`)
  }
  const after = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  if (after > SCHEMA_VERSION) {
    throw new Error(
      `このDBはスキーマ v${after} です。コードが知っているのは v${SCHEMA_VERSION} まで。` +
      '新しい版で書かれたDBを古いコードで開くとデータを壊すので、コードを更新してください。',
    )
  }
}

/** statusの自由文からoutcome(列挙)を機械判定する。書き込み側はstatus更新時に必ずこれも更新する */
export function outcomeOf(status: string): string {
  const s = status.trim()
  if (!s) return '進行中'
  if (/不合格|欠席|振替不可|お見送り|見送り|実質終了/.test(s)) return '不合格'
  if (/辞退/.test(s)) return '辞退'
  if (/内定/.test(s)) return '内定'
  if (/合格|参加|通過/.test(s.replace(/不合格/g, ''))) return '合格'
  return '進行中'
}

// ---- 名寄せ(エンティティ解決) ----

/**
 * 法人格(法的な種類)の表記。トレードネームではないので、名寄せの「芯」からは落としてよい。
 *
 * ここに入れてよいのは「法人の種類」だけ。`holdings` `group` `company` のような
 * トレードネームの一部になりうる語を入れてはいけない(「X Holdings」と「X」は別法人)。
 */
const DESIGNATOR_JP =
  /株式会社|合同会社|合資会社|合名会社|有限会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|学校法人|医療法人|独立行政法人|国立大学法人|特定非営利活動法人|\(株\)|\(有\)|\(同\)/g
const DESIGNATOR_EN = /\b(inc|incorporated|corp|corporation|co|ltd|limited|llc|llp|lp|kk|gk|gmbh|plc|pte|pty)\b/g

/** 表記揺れ(全半角・大小・句読点)だけを畳む。法人格は落とさない */
function normalizeSurface(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[.,、。]/g, ' ')
    .replace(/[()\s　]/g, '')
}

/** 法人格の揺れも吸収した「芯」。日本語(株式会社等)と海外表記(Inc./Ltd./Corp.等)の両対応 */
function normalize(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[.,、。]/g, ' ')
    .replace(DESIGNATOR_JP, ' ')
    .replace(DESIGNATOR_EN, ' ')
    .replace(/[()\s　]/g, '')
}

/** 同義の法人格表記を1つに寄せる(Co.,Ltd. と Ltd. を別物にしないため) */
const DESIGNATOR_CANON: Record<string, string> = {
  incorporated: 'inc', corporation: 'corp', limited: 'ltd', '(株)': '株式会社', '(有)': '有限会社', '(同)': '合同会社',
}

/** 名前が担っている法人格の集合を返す(例: "Sample Co., Ltd." → {co, ltd}) */
function designatorsOf(name: string): Set<string> {
  const s = name.normalize('NFKC').toLowerCase().replace(/[.,、。]/g, ' ')
  const found = [...(s.match(DESIGNATOR_JP) ?? []), ...(s.match(DESIGNATOR_EN) ?? [])]
  return new Set(found.map((d) => DESIGNATOR_CANON[d] ?? d))
}

/**
 * 法人格が矛盾しているか。片方が無印、または一方が他方の部分集合なら矛盾しない。
 * 「株式会社X」と「合同会社X」、「X K.K.」と「X Corp」のような別法人だけを弾く。
 */
function designatorsConflict(a: string, b: string): boolean {
  const da = designatorsOf(a)
  const db_ = designatorsOf(b)
  if (da.size === 0 || db_.size === 0) return false
  const subset = (x: Set<string>, y: Set<string>) => [...x].every((v) => y.has(v))
  return !subset(da, db_) && !subset(db_, da)
}

export function sameCompany(a: string, b: string): boolean {
  const na = normalize(a)
  const nb = normalize(b)
  // 部分一致は両方4文字以上のときだけ(「アオイ」⊂「アオイ・システムズ・プロ」の誤マージを防ぐ)
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

/** ポジション(トラック)の同一判定。完全一致に加え、両方4文字以上なら包含も許容する */
/**
 * 単独では選考トラックを特定できない一般語。包含一致を許すと別トラックを誤って統合する。
 * 2026-07-30: PwCの「コンサル(夏・不合格)」に「Autumn Internship(ビジネスコンサルタント職)」が
 * 包含一致で吸い込まれ、終了済みトラックへ新規案内の次アクションが書き込まれた。
 */
const GENERIC_POSITION = /^(コンサル|コンサルタント|エンジニア|営業|技術|技術職|総合職|事務|本選考)$/

export function samePosition(a: string, b: string): boolean {
  const na = normalize(a)
  const nb = normalize(b)
  if (!na || !nb) return na === nb
  if (na === nb) return true
  // 片方が一般語だけのときは完全一致のみ同一トラックとみなす
  if (GENERIC_POSITION.test(na) || GENERIC_POSITION.test(nb)) return false
  return na.length >= 4 && nb.length >= 4 && (na.includes(nb) || nb.includes(na))
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
 * - 終了系(不合格・辞退)は根拠があれば合格からでも確定できる(合格からの終了確定を許す問題の解消)。不合格と辞退は別語で書く
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

// ---- 名寄せ(正式名称ベース + 学習) ----

export type Resolution =
  | { kind: 'hit'; companyId: number }
  | { kind: 'suspicious'; suggestId: number; suggestName: string }
  | { kind: 'new' }

/**
 * 企業名の解決(本人方針 2026-07-18「基本は正式名称。怪しいものは確認して学習」):
 * 1. 表記揺れ(全半角・大小・カッコ)だけの違い → 確定
 * 2. 学習済みエイリアス → 確定
 * 3. 法人格を落とすと一致する → 法人格が矛盾しなければ確定、矛盾するなら「怪しい」
 * 4. 部分一致で似た企業がある → 「怪しい」。勝手にマージせず suspicious を返す(呼び手が要確認に積む)
 * 5. どれにも当たらない → 新企業
 *
 * 3 の分岐が要点。`normalize` は法人格を落とすので「株式会社X」と「合同会社X」、
 * 「X K.K.」と「X Corp」が同じ芯に潰れる。これらは別法人でありうるので自動マージせず、
 * 本人の確認(=alias 学習)を1回だけ挟む。
 */
export function resolveCompany(db: DatabaseSync, name: string): Resolution {
  const n = normalize(name)
  const surface = normalizeSurface(name)
  const all = db.prepare('SELECT id, name, short_name FROM company').all() as { id: number; name: string; short_name: string }[]

  // 1. 法人格まで含めて表記揺れだけの違い → 無条件に確定(正式名称でも通称でも当たる)
  const exact = all.find(
    (r) => normalizeSurface(r.name) === surface || (r.short_name && normalizeSurface(r.short_name) === surface),
  )
  if (exact) return { kind: 'hit', companyId: exact.id }

  // 2. 本人が確認済みのエイリアス
  const alias = db.prepare('SELECT company_id FROM company_alias WHERE alias_norm = ?').get(n) as
    | { company_id: number }
    | undefined
  if (alias) return { kind: 'hit', companyId: alias.company_id }

  // 芯が空(名前が法人格だけ)や1文字は、一致とみなすには弱すぎる
  if (n.length < 2) return { kind: 'new' }

  // 3. 法人格を落とすと一致する
  const stem = all.find((r) => normalize(r.name) === n || (r.short_name && normalize(r.short_name) === n))
  if (stem) {
    const against = normalize(stem.name) === n ? stem.name : stem.short_name
    return designatorsConflict(against, name)
      ? { kind: 'suspicious', suggestId: stem.id, suggestName: stem.name }
      : { kind: 'hit', companyId: stem.id }
  }

  // 4. 部分一致どまり
  const fuzzy = all.find((r) => sameCompany(r.name, name))
  if (fuzzy) return { kind: 'suspicious', suggestId: fuzzy.id, suggestName: fuzzy.name }
  return { kind: 'new' }
}

/** 本人確認済みの別名を学習する。canonical は既存の正式名称(正規化一致)であること */
export function addAlias(db: DatabaseSync, alias: string, canonical: string): number {
  const r = resolveCompany(db, canonical)
  if (r.kind !== 'hit') throw new Error(`正式名称が見つかりません: ${canonical}`)
  db.prepare('INSERT OR REPLACE INTO company_alias (alias_norm, alias, company_id, created_at) VALUES (?, ?, ?, ?)')
    .run(normalize(alias), alias, r.companyId, new Date().toISOString())
  db.prepare('UPDATE pending_review SET resolved = 1 WHERE name = ?').run(alias)
  return r.companyId
}

export function addPending(db: DatabaseSync, name: string, context: string): void {
  const dup = db.prepare('SELECT id FROM pending_review WHERE name = ? AND resolved = 0').get(name)
  if (!dup) db.prepare('INSERT INTO pending_review (name, context, created_at) VALUES (?, ?, ?)').run(name, context, new Date().toISOString())
}

export function listPending(db: DatabaseSync): { name: string; context: string; created_at: string }[] {
  return db.prepare('SELECT name, context, created_at FROM pending_review WHERE resolved = 0 ORDER BY id').all() as {
    name: string
    context: string
    created_at: string
  }[]
}

// ---- イベント(状態変化の一次記録) ----

export function addEvent(db: DatabaseSync, selectionId: number, kind: string, summary: string, source = '', at?: string, ref?: string): void {
  db.prepare('INSERT INTO event (selection_id, at, kind, summary, source, ref) VALUES (?, ?, ?, ?, ?, ?)')
    .run(selectionId, at ?? new Date().toISOString(), kind, summary, source, ref ?? '')
}

// ---- 予定(面接・締切・説明会) ----

export interface Appointment {
  id?: number
  selectionId: number
  at: string
  /** 終了時刻(ISO)。録画の自動停止に使う。省略時は開始+60分扱い */
  endAt?: string
  kind: string
  title: string
  url?: string
  location?: string
  person?: string
  status?: string
}

/**
 * 予定の開始時刻を突合用に正規化する。
 * - カレンダー由来は `2026-07-24T14:00:00+09:00`、メール由来は `2026-07-24T14:00` のように
 *   同じ瞬間でも表記が違う。文字列一致だけで突合すると同じ会議が2行に割れる(2026-07-24の実害)
 * - タイムゾーン無しの入力は日本時間として解釈する。実行マシンのTZ設定に判定が左右されると、
 *   同じデータでも重複判定がぶれるため(本プロジェクトは Asia/Tokyo 固定運用)
 * - 解釈できない文字列は元のまま返す(壊すより触らない)
 */
export function normalizeAppointmentAt(at: string | null | undefined): string {
  const raw = (at ?? '').trim()
  if (!raw) return ''
  const withTime = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00` : raw.replace(' ', 'T')
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(withTime)
  const ms = Date.parse(hasZone ? withTime : `${withTime}+09:00`)
  return Number.isNaN(ms) ? raw : new Date(ms).toISOString()
}

/** 会議URLを突合用に正規化する(末尾スラッシュ・ホストの大小・フラグメントの揺れを吸収) */
export function normalizeAppointmentUrl(url: string | null | undefined): string {
  const raw = (url ?? '').trim()
  if (!raw) return ''
  try {
    const parsed = new URL(raw)
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${parsed.pathname.replace(/\/+$/, '')}${parsed.search}`
  } catch {
    return raw.replace(/\/+$/, '')
  }
}

/** 突合に使う予定の最小情報(DBの行でも、これから入れる入力でも同じ形で比べられる) */
export interface AppointmentLike {
  at: string
  title?: string
  url?: string
  kind?: string
}

/** 同じ枠(同じ開始時刻)か。時刻が読めない行は突合対象にしない */
function sameSlot(a: AppointmentLike, b: AppointmentLike): boolean {
  const at = normalizeAppointmentAt(a.at)
  return at !== '' && at === normalizeAppointmentAt(b.at)
}
/** 突合1: タイトル一致(従来の突合。URLが両方空でもここで拾える) */
function matchByTitle(a: AppointmentLike, b: AppointmentLike): boolean {
  const title = (a.title ?? '').trim()
  return title !== '' && title === (b.title ?? '').trim()
}
/** 突合2: 会議URL一致(タイトルや敬称の揺れ「山田さん/山田様」は無視できる) */
function matchByUrl(a: AppointmentLike, b: AppointmentLike): boolean {
  const url = normalizeAppointmentUrl(a.url)
  return url !== '' && url === normalizeAppointmentUrl(b.url)
}
/** 突合3: 片方だけURLが空 かつ 種別一致(締切は除外)。情報量の差だけで別行になるのを防ぐ */
function matchByBlankUrl(a: AppointmentLike, b: AppointmentLike): boolean {
  const kind = (a.kind ?? '').trim()
  if (!kind || kind === '締切' || kind !== (b.kind ?? '').trim()) return false
  return (normalizeAppointmentUrl(a.url) === '') !== (normalizeAppointmentUrl(b.url) === '')
}

/**
 * 2件の予定が同じ会議を指すか(同一トラック=selection_id であることは呼び手が保証する)。
 * findAppointmentMatch と同じ規則の「対称版」。点検スクリプトが行同士を比べるのに使う。
 */
export function sameAppointment(a: AppointmentLike, b: AppointmentLike): boolean {
  return sameSlot(a, b) && (matchByTitle(a, b) || matchByUrl(a, b) || matchByBlankUrl(a, b))
}

export interface AppointmentMatch extends AppointmentLike {
  selectionId: number
  /** trueならexternal_idが空の行(=メール・手入力由来)だけを突合対象にする。カレンダー側の昇格用 */
  onlyWithoutExternalId?: boolean
  /** 自分自身を除外したいとき(点検スクリプトが行同士を比べる用途) */
  excludeId?: number
}

/**
 * 同じ会議を指す既存の appointment を探す(重複作成を防ぐ単一の突合規則)。
 *
 * 背景(2026-07-24): 同じある面談が「カレンダー由来(external_idあり)」と
 * 「メール由来(external_idなし)」で別行になり、meeting-autopilot が同じURLを二重に開き
 * 録音セッションも二重起動しうる状態になっていた。原因は突合キーが経路ごとにバラバラだったこと。
 *
 * 前提: 同一トラック(selection)で「同じ開始時刻」の予定が2つ並ぶことは実際には起きない
 * (同じ会社の面談を同じ分に2件は受けられない)。だから突合は必ず selection_id × 開始時刻を土台にし、
 * その中で次の順に同一とみなす。
 *   1. タイトル一致 …… 従来の突合。URLが両方空でもここで拾える
 *   2. URL一致 …… 会議URLが同じなら、タイトルや敬称の揺れ(山田さん/山田様)は無視して同一
 *   3. 片方だけURLが空 かつ 種別(kind)一致 …… メールにURLが載っていない/カレンダーにURLが無い等、
 *      情報量の差だけで別行になるのを防ぐ。ただし「締切」は同一時刻(23:59等)に複数並ぶのが普通なので
 *      この緩い規則からは外す(締切はタイトルかURLが一致しない限り別物)
 * 両方のURLが非空で異なる場合は別会議とみなす(同時刻でも別々のリンクなら統合しない)。
 */
export function findAppointmentMatch(db: DatabaseSync, m: AppointmentMatch): number | undefined {
  if (normalizeAppointmentAt(m.at) === '') return undefined
  const rows = db.prepare('SELECT id, at, title, url, kind, external_id FROM appointment WHERE selection_id = ? ORDER BY id')
    .all(m.selectionId) as { id: number; at: string; title: string; url: string; kind: string; external_id: string }[]
  const slot = rows.filter((r) =>
    r.id !== m.excludeId &&
    sameSlot(m, r) &&
    (!m.onlyWithoutExternalId || !r.external_id))
  if (slot.length === 0) return undefined
  // タイトル → URL → 片方だけURL空、の順に確からしい行を選ぶ(複数当たったときの優先順)
  const hit = slot.find((r) => matchByTitle(m, r))
    ?? slot.find((r) => matchByUrl(m, r))
    ?? slot.find((r) => matchByBlankUrl(m, r))
  return hit?.id
}

/** 予定を追加する。同一の会議(findAppointmentMatch の規則)は重複させず、空欄だけ補完する */
export function addAppointment(db: DatabaseSync, a: Appointment): { id: number; created: boolean } {
  const now = new Date().toISOString()
  const matchId = findAppointmentMatch(db, {
    selectionId: a.selectionId, at: a.at, title: a.title, url: a.url, kind: a.kind,
  })
  const dup = matchId === undefined
    ? undefined
    : db.prepare('SELECT id, url, location, person FROM appointment WHERE id = ?')
      .get(matchId) as { id: number; url: string; location: string; person: string } | undefined
  if (dup) {
    const fill = (col: string, v?: string) => {
      if (v && !(dup as unknown as Record<string, string>)[col]) db.prepare(`UPDATE appointment SET ${col} = ? WHERE id = ?`).run(v, dup.id)
    }
    fill('url', a.url)
    fill('location', a.location)
    fill('person', a.person)
    if (a.endAt) db.prepare("UPDATE appointment SET end_at = ? WHERE id = ? AND end_at = ''").run(a.endAt, dup.id)
    return { id: dup.id, created: false }
  }
  const r = db.prepare(
    'INSERT INTO appointment (selection_id, at, end_at, kind, title, url, location, person, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(a.selectionId, a.at, a.endAt ?? '', a.kind || 'その他', a.title, a.url ?? '', a.location ?? '', a.person ?? '', a.status ?? '予定', now)
  return { id: Number(r.lastInsertRowid), created: true }
}

export interface AppointmentRow extends Required<Appointment> {
  company: string
}

export function listAppointments(db: DatabaseSync): AppointmentRow[] {
  const rows = db.prepare(`
    SELECT a.id, a.selection_id, a.at, a.end_at, a.kind, a.title, a.url, a.location, a.person, a.status,
           CASE WHEN c.short_name <> '' THEN c.short_name ELSE c.name END AS company
    FROM appointment a
    JOIN selection s ON s.id = a.selection_id
    JOIN company c ON c.id = s.company_id
    ORDER BY a.at
  `).all() as Record<string, unknown>[]
  return rows.map((r) => ({
    id: r.id as number,
    selectionId: r.selection_id as number,
    at: r.at as string,
    endAt: (r.end_at as string) ?? '',
    kind: r.kind as string,
    title: r.title as string,
    url: r.url as string,
    location: r.location as string,
    person: r.person as string,
    status: r.status as string,
    company: r.company as string,
  }))
}

export interface EventRow {
  selection_id: number
  at: string
  kind: string
  summary: string
  source: string
}

export function listEvents(db: DatabaseSync, selectionId?: number): EventRow[] {
  const sql = 'SELECT selection_id, at, kind, summary, source FROM event' + (selectionId ? ' WHERE selection_id = ?' : '') + ' ORDER BY id'
  return db.prepare(sql).all(...(selectionId ? [selectionId] : [])) as unknown as EventRow[]
}

// ---- 読み書きヘルパー ----

export function upsertCompany(db: DatabaseSync, info: Partial<CompanyInfo> & { name: string }): number {
  const now = new Date().toISOString()
  // 自動マージは正規化一致とエイリアスのみ(部分一致の推測マージはしない。怪しいものは呼び手が確認に回す)
  const reso = resolveCompany(db, info.name)
  const hit = reso.kind === 'hit' ? { id: reso.companyId } : undefined
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
  // 怪しい(法人格違い・部分一致)ものは黙って別法人を作らず、要確認に積んでから作る。
  // 同一だった場合は本人が addAlias で寄せられる。
  if (reso.kind === 'suspicious') {
    addPending(db, info.name, `既存「${reso.suggestName}」と紛らわしい。同一なら別名として学習、別会社ならこのままでよい`)
  }
  const r = db.prepare(
    'INSERT INTO company (name, short_name, industry, mypage_url, login_id, password, memo, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(info.name, info.shortName ?? info.name, info.industry ?? '', info.mypageUrl ?? '', info.loginId ?? '', info.password ?? '', info.memo ?? '', now)
  return Number(r.lastInsertRowid)
}

export function insertSelection(db: DatabaseSync, companyId: number, s: Selection, by = 'agent'): number {
  const now = new Date().toISOString()
  const r = db.prepare(`
    INSERT INTO selection (company_id, season, position, priority, status, step1, step2, step3, step4,
      next_action, next_date, submitted, es_url, memo, outcome, updated_at, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    companyId, s.season, s.position, s.priority, s.status,
    s.steps[0] ?? '', s.steps[1] ?? '', s.steps[2] ?? '', s.steps[3] ?? '',
    s.nextAction, s.nextDate, s.submitted ? 1 : 0, s.esUrl, s.memo, outcomeOf(s.status), now, by,
  )
  return Number(r.lastInsertRowid)
}

export interface SelectionRow extends Selection {
  id: number
  companyId: number
}

export function listSelections(db: DatabaseSync): SelectionRow[] {
  // 表示は通称(短い名前)。正式名称は company 側(name)が正
  const rows = db.prepare(`
    SELECT s.id, s.company_id, CASE WHEN c.short_name <> '' THEN c.short_name ELSE c.name END AS disp,
           s.season, s.position, s.priority, s.status,
           s.step1, s.step2, s.step3, s.step4, s.next_action, s.next_date, s.submitted, s.es_url, s.memo
    FROM selection s JOIN company c ON c.id = s.company_id
    ORDER BY s.id
  `).all() as Record<string, unknown>[]
  return rows.map((r) => ({
    id: r.id as number,
    companyId: r.company_id as number,
    company: r.disp as string,
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
    shortName: (r.short_name as string) ?? '',
    industry: r.industry as string,
    mypageUrl: r.mypage_url as string,
    loginId: r.login_id as string,
    password: r.password as string,
    memo: r.memo as string,
  }))
}

/** 正式名称(株式会社/Inc.付き)へ昇格する。従来の名前は通称(short_name)として残る */
export function setOfficialName(db: DatabaseSync, name: string, officialName: string): void {
  const r = resolveCompany(db, name)
  if (r.kind !== 'hit') throw new Error(`企業が見つかりません: ${name}`)
  const cur = db.prepare('SELECT name, short_name FROM company WHERE id = ?').get(r.companyId) as { name: string; short_name: string }
  const short = cur.short_name || cur.name
  db.prepare('UPDATE company SET name = ?, short_name = ?, updated_at = ? WHERE id = ?')
    .run(officialName, short, new Date().toISOString(), r.companyId)
}
