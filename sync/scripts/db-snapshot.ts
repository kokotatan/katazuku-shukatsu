/**
 * 正本DB → アプリ用スナップショット(JSON)の生成とクラウドへのプッシュ。
 * DBに書いたら必ずこれを実行する(db-applyの後・会話でDBを書いた後)。数秒後にはアプリが最新を映す。
 *
 *   npx tsx scripts/db-snapshot.ts           # 生成 + ローカルバックアップ + プッシュ
 *   npx tsx scripts/db-snapshot.ts --no-push # 生成のみ(オフライン時)
 *
 * プッシュ先: /api/push (Vercel)。認証は repo直下 .env の KATAZUKU_WRITE_SECRET。
 * スナップショットに**パスワード列は含めない**(クラウドに置くため)。
 */
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { openDb, listCompanies, listSelections, listAppointments, listEvents } from '../src/db'
import { listPlatformSnapshot } from '../src/platform'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DB_PATH = process.env.KATAZUKU_DB ?? join(root, 'data', 'katazuku.db')

/** repo直下の .env から KEY=VALUE を読む(依存ゼロの簡易パーサ) */
function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  const p = join(root, '.env')
  if (!existsSync(p)) return out
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) out[m[1]] = m[2].trim()
  }
  return out
}

function buildSnapshot() {
  const db = openDb(DB_PATH)
  const selections = listSelections(db)
  const outcomes = db.prepare('SELECT id, outcome, next_date FROM selection').all() as { id: number; outcome: string; next_date: string }[]
  const oMap = new Map(outcomes.map((o) => [o.id, o]))
  return {
    generatedAt: new Date().toISOString(),
    companies: listCompanies(db).map(({ password: _pw, ...c }) => c), // パスワードは絶対に載せない
    selections: selections.map((s) => ({ ...s, outcome: oMap.get(s.id)?.outcome ?? '' })),
    appointments: listAppointments(db),
    events: listEvents(db).slice(-100),
    activities: loadActivities(),
    ...listPlatformSnapshot(db),
  }
}

/** 活動ログ(何を/何のために/どうしたか)も同梱してアプリで見えるようにする */
function loadActivities(): unknown[] {
  const p = join(root, 'logs', 'activity-log.jsonl')
  if (!existsSync(p)) return []
  const lines = readFileSync(p, 'utf8').split('\n').filter((l) => l.trim())
  return lines.slice(-50).map((l) => {
    try { return JSON.parse(l) } catch { return null }
  }).filter(Boolean)
}

/** DBファイルの日次バックアップ(14日ぶん保持)。スナップショットのたびに確認する */
function backupDb() {
  const dir = join(root, 'logs', 'db-backup')
  mkdirSync(dir, { recursive: true })
  const today = new Date().toISOString().slice(0, 10)
  const dest = join(dir, `katazuku-${today}.db`)
  if (!existsSync(dest) && existsSync(DB_PATH)) {
    copyFileSync(DB_PATH, dest)
    console.log(`バックアップ: ${dest}`)
  }
  const files = readdirSync(dir).filter((f) => f.startsWith('katazuku-')).sort()
  for (const f of files.slice(0, Math.max(0, files.length - 14))) rmSync(join(dir, f))
}

async function main() {
  const snap = buildSnapshot()
  const outPath = join(root, 'data', 'snapshot.json')
  writeFileSync(outPath, JSON.stringify(snap), 'utf8')
  console.log(`スナップショット生成: 選考${snap.selections.length} / 予定${snap.appointments.length} / 企業${snap.companies.length} -> ${outPath}`)
  backupDb()

  if (process.argv.includes('--no-push')) return
  const env = loadEnv()
  const secret = process.env.KATAZUKU_WRITE_SECRET ?? env.KATAZUKU_WRITE_SECRET
  const url = process.env.KATAZUKU_PUSH_URL ?? env.KATAZUKU_PUSH_URL ?? 'https://katazuku.kotalabo.com/api/push'
  if (!secret) {
    console.log('KATAZUKU_WRITE_SECRET が .env に無いためプッシュはスキップ(生成のみ)')
    return
  }
  let res: Response
  try {
    res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify(snap),
    })
  } catch (error) {
    console.error(`警告: プッシュ接続失敗: ${error instanceof Error ? error.message : String(error)}`)
    return
  }
  if (!res.ok) {
    // 輸送はベストエフォート(未設定・オフラインでもDB本体の処理は成功扱い)。ただし警告は残す
    console.error(`警告: プッシュ失敗 (${res.status}): ${(await res.text()).slice(0, 200)}`)
    return
  }
  console.log('クラウドへプッシュ完了(アプリは数秒後に最新を表示)')
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
