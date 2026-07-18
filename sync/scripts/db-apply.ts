/**
 * daily-sync がGmailから抽出した差分JSONを正本DBへ反映する(旧 sheet-sync の後継)。
 * 書き込み規則は src/db.ts の transition() に集約(終了系は根拠があれば確定・復活はさせない・
 * 詳しい手書きステータスを粗い進行中で潰さない)。
 *
 * 差分JSON: [{name, stage, nextAction?, nextDate?, industry?, season?, position?}, ...]
 *
 * 実行: cd sync && npx tsx scripts/db-apply.ts <diff.json> [--force]
 * 暴走ブレーキ: 変更が MAX_APPLY_CHANGES 社を超えたら中止(--force で解除)
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { openDb, upsertCompany, insertSelection, transition, samePosition, STATUS_FOR, type Stage } from '../src/db'

export const MAX_APPLY_CHANGES = 15

export interface DiffItem {
  name: string
  stage: Stage
  nextAction?: string
  nextDate?: string
  industry?: string
  season?: string
  position?: string
}

export interface ApplyResult {
  updated: string[]
  added: string[]
  skipped: string[] // 複数トラックがあって特定できず触らなかった企業
}

export function applyDiff(db: DatabaseSync, items: DiffItem[], by = 'daily-sync'): ApplyResult {
  const now = new Date().toISOString()
  const res: ApplyResult = { updated: [], added: [], skipped: [] }

  // バッチ全体を1トランザクションに(半適用を防ぐ。busy_timeoutはopenDbで設定済み)
  db.exec('BEGIN IMMEDIATE')
  try {
  for (const it of items) {
    const name = (it.name ?? '').trim()
    if (!name) continue
    const cid = upsertCompany(db, { name, industry: it.industry })

    const sels = db.prepare('SELECT id, position, status, next_action, next_date FROM selection WHERE company_id = ?')
      .all(cid) as { id: number; position: string; status: string; next_action: string; next_date: string }[]

    // トラックの特定: position指定があれば完全一致のみ。一致ゼロなら「別トラックの新情報」として追加する。
    // position指定なしで複数トラック → どれの話か分からないので保留(壊すより触らない)
    let target: (typeof sels)[number] | undefined
    let addAsNewTrack = sels.length === 0
    if (!addAsNewTrack) {
      if (it.position) {
        target = sels.find((s) => samePosition(s.position, it.position!))
        if (!target) addAsNewTrack = true // 例: Sansan(3days)しか無いところに Sansan 1day の話が来た
      } else if (sels.length === 1) {
        target = sels[0]
      }
    }

    if (addAsNewTrack) {
      insertSelection(db, cid, {
        company: name,
        season: it.season ?? '',
        position: it.position ?? '',
        priority: '',
        status: STATUS_FOR[it.stage],
        steps: [],
        nextAction: it.nextAction ?? '',
        nextDate: it.nextDate ?? '',
        submitted: false,
        esUrl: '',
        memo: '',
      }, by)
      res.added.push(name)
      continue
    }
    if (!target) {
      // どのトラック(ポジション)の話か特定できない。壊すより触らない
      res.skipped.push(name)
      continue
    }

    let changed = false
    const next = transition(target.status, it.stage)
    if (next) {
      db.prepare('UPDATE selection SET status = ?, updated_at = ?, updated_by = ? WHERE id = ?').run(next, now, by, target.id)
      changed = true
    }
    // 次アクション・締切はメール由来の最新情報で更新する(agentが唯一の書き手)
    if (it.nextAction && it.nextAction !== target.next_action) {
      db.prepare('UPDATE selection SET next_action = ?, updated_at = ?, updated_by = ? WHERE id = ?').run(it.nextAction, now, by, target.id)
      changed = true
    }
    if (it.nextDate && it.nextDate !== target.next_date) {
      db.prepare('UPDATE selection SET next_date = ?, updated_at = ?, updated_by = ? WHERE id = ?').run(it.nextDate, now, by, target.id)
      changed = true
    }
    if (changed) res.updated.push(name)
  }
  db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return res
}

// ---- CLI ----
const invokedDirectly =
  process.argv[1] != null &&
  resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()

if (invokedDirectly) {
  const DB_PATH = process.env.KATAZUKU_DB ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'katazuku.db')
  const args = process.argv.slice(2)
  const diffPath = args.find((a) => !a.startsWith('--'))
  if (!diffPath) {
    console.error('使い方: npx tsx scripts/db-apply.ts <diff.json> [--force]')
    process.exit(1)
  }
  const items = JSON.parse(readFileSync(diffPath, 'utf8')) as DiffItem[]
  const db = openDb(DB_PATH)

  // 事前に件数だけ数えて暴走ブレーキ(dry計算はせず、対象社数で判定)
  if (items.length > MAX_APPLY_CHANGES && !args.includes('--force')) {
    console.error(`差分が ${items.length} 社あり、上限 ${MAX_APPLY_CHANGES} 社を超えています。中止しました(--force で実行可)。`)
    process.exit(1)
  }

  const res = applyDiff(db, items)
  console.log(`DB反映: 更新 ${res.updated.length}社 / 追加 ${res.added.length}社 / 保留 ${res.skipped.length}社`)
  if (res.updated.length) console.log(`  更新: ${res.updated.join('、')}`)
  if (res.added.length) console.log(`  追加: ${res.added.join('、')}`)
  if (res.skipped.length) console.log(`  保留(複数トラックで特定不能・要目視): ${res.skipped.join('、')}`)
}
