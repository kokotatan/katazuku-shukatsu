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
import { openDb, upsertCompany, insertSelection, transition, samePosition, resolveCompany, addPending, addEvent, addAppointment, listPending, outcomeOf, STATUS_FOR, type Stage } from './db.js'

export const MAX_APPLY_CHANGES = 15

export interface DiffItem {
  name: string
  stage: Stage
  nextAction?: string
  nextDate?: string
  industry?: string
  season?: string
  position?: string
  /** 面接・締切・説明会などの予定(日時はISO。時刻・終了時刻・URL・場所・相手まで取る) */
  appointments?: { at: string; endAt?: string; kind?: string; title: string; url?: string; location?: string; person?: string }[]
  /** 根拠メールのID等(イベントのref) */
  ref?: string
}

export interface ApplyResult {
  updated: string[]
  added: string[]
  skipped: string[] // 複数トラックがあって特定できず触らなかった企業
  pending: string[] // 名寄せが怪しく、本人確認待ちに積んだ企業(DBには書かない)
}

export function applyDiff(db: DatabaseSync, items: DiffItem[], by = 'daily-sync'): ApplyResult {
  const now = new Date().toISOString()
  const res: ApplyResult = { updated: [], added: [], skipped: [], pending: [] }

  // バッチ全体を1トランザクションに(半適用を防ぐ。busy_timeoutはopenDbで設定済み)
  db.exec('BEGIN IMMEDIATE')
  try {
  for (const it of items) {
    const name = (it.name ?? '').trim()
    if (!name) continue

    // stage を実行時に検証する。未知のstage(タイポ・将来値・外部LLMの誤り)1件で
    // バッチ全体がロールバックしないよう、その1件だけ skip する。
    if (!(it.stage in STATUS_FOR)) { res.skipped.push(name); continue }

    // 名寄せ(2026-07-18本人方針): 正式名称・学習済み別名だけ自動。似ているだけなら本人確認に積んで触らない
    const r = resolveCompany(db, name)
    if (r.kind === 'suspicious') {
      addPending(db, name, `似た企業「${r.suggestName}」あり。同一なら別名として学習、別会社なら新規登録 (stage=${it.stage}${it.position ? `, position=${it.position}` : ''})`)
      res.pending.push(`${name}(候補: ${r.suggestName})`)
      continue
    }
    const cid = upsertCompany(db, { name, industry: it.industry })

    const sels = db.prepare('SELECT id, position, status, next_action, next_date FROM selection WHERE company_id = ?')
      .all(cid) as { id: number; position: string; status: string; next_action: string; next_date: string }[]

    // トラックの特定: position指定があれば完全一致または長い名称の包含一致。
    // 既存が1本かつposition空欄なら、具体名が判明した同じトラックとして育てる。
    // position指定なしで複数トラック → どれの話か分からないので保留(壊すより触らない)
    let target: (typeof sels)[number] | undefined
    let addAsNewTrack = sels.length === 0
    if (!addAsNewTrack) {
      if (it.position) {
        target = sels.find((s) => samePosition(s.position, it.position!))
        if (!target && sels.length === 1 && !sels[0].position.trim()) {
          target = sels[0]
          db.prepare('UPDATE selection SET position = ?, updated_at = ?, updated_by = ? WHERE id = ?')
            .run(it.position, now, by, target.id)
          target.position = it.position
        }
        if (!target) addAsNewTrack = true // 例: アクメ(3days)しか無いところに アクメ 1day の話が来た
      } else if (sels.length === 1) {
        target = sels[0]
      }
    }

    if (addAsNewTrack) {
      const sid = insertSelection(db, cid, {
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
      addEvent(db, sid, '新規', `${STATUS_FOR[it.stage]}として登録${it.position ? `(${it.position})` : ''}`, by, undefined, it.ref)
      for (const ap of it.appointments ?? []) {
        addAppointment(db, { selectionId: sid, at: ap.at, endAt: ap.endAt, kind: ap.kind ?? 'その他', title: ap.title, url: ap.url, location: ap.location, person: ap.person })
        addEvent(db, sid, '予定追加', `${ap.title} (${ap.at})`, by, undefined, it.ref)
      }
      res.added.push(name)
      continue
    }
    if (!target) {
      // どのトラック(ポジション)の話か特定できない。壊すより触らない
      res.skipped.push(name)
      continue
    }

    // イベント起点(2026-07-18本人方針): 変化は必ずイベントとして記録し、statusはその結果のキャッシュ
    let changed = false
    const next = transition(target.status, it.stage)
    if (next) {
      db.prepare('UPDATE selection SET status = ?, outcome = ?, updated_at = ?, updated_by = ? WHERE id = ?')
        .run(next, outcomeOf(next), now, by, target.id)
      addEvent(db, target.id, '状態変化', `${target.status || '(空)'} → ${next}`, by, undefined, it.ref)
      changed = true
    }
    for (const ap of it.appointments ?? []) {
      const added = addAppointment(db, { selectionId: target.id, at: ap.at, endAt: ap.endAt, kind: ap.kind ?? 'その他', title: ap.title, url: ap.url, location: ap.location, person: ap.person })
      if (added.created) {
        addEvent(db, target.id, '予定追加', `${ap.title} (${ap.at})`, by, undefined, it.ref)
        changed = true
      }
    }
    // 次アクション・締切はメール由来の最新情報で更新する(agentが唯一の書き手)
    if (it.nextAction && it.nextAction !== target.next_action) {
      db.prepare('UPDATE selection SET next_action = ?, updated_at = ?, updated_by = ? WHERE id = ?').run(it.nextAction, now, by, target.id)
      addEvent(db, target.id, '予定更新', `次アクション: ${it.nextAction}`, by)
      changed = true
    }
    if (it.nextDate && it.nextDate !== target.next_date) {
      db.prepare('UPDATE selection SET next_date = ?, updated_at = ?, updated_by = ? WHERE id = ?').run(it.nextDate, now, by, target.id)
      addEvent(db, target.id, '予定更新', `締切・選考日: ${it.nextDate}`, by)
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
  const DB_PATH = (process.env.KATAZUKU_DB || process.env.KATAZUKU_DB_PATH) ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'katazuku.db')
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
  console.log(`DB反映: 更新 ${res.updated.length}社 / 追加 ${res.added.length}社 / 保留 ${res.skipped.length}社 / 名寄せ要確認 ${res.pending.length}社`)
  if (res.updated.length) console.log(`  更新: ${res.updated.join('、')}`)
  if (res.added.length) console.log(`  追加: ${res.added.join('、')}`)
  if (res.skipped.length) console.log(`  保留(複数トラックで特定不能・要目視): ${res.skipped.join('、')}`)
  if (res.pending.length) console.log(`  名寄せ要確認(本人に確認→ db-alias.ts で学習): ${res.pending.join('、')}`)
  const pend = listPending(db)
  if (pend.length) console.log(`  ※未解決の名寄せ確認が ${pend.length} 件あります(npx tsx scripts/db-alias.ts list)`)
}
