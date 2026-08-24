/**
 * daily-sync の決定論的executor(Phase B / spec14「副作用の分離」)。
 *
 * モデルは Gmail を読んで抽出した「厳格JSON」を返すだけ(read-only・副作用なし)。
 * このスクリプトが JSON Schema で検証してから、既存の db-apply-* を1つのDB接続で束ねて反映する。
 * モデルにSQLやDB書き込みを委ねない。どのprovider(Claude/Codex/OSS)が抽出しても、
 * ここを通る限り同じ検証・遷移規則・冪等化・暴走ブレーキが等しく効く。
 *
 * 実行: cd sync && npx tsx scripts/daily-sync-apply.ts <result.json> [--db <path>] [--force]
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DatabaseSync } from 'node:sqlite'
import { openDb } from '../src/db'
import { resolveDatabasePath } from '../src/database-path'
import { validateJsonSchema } from '../src/agent-runtime'
import { applyDiff, MAX_APPLY_CHANGES, type DiffItem } from './db-apply'
import { applyMail } from './db-apply-mail'
import { applySubmission } from './db-apply-submission'

const scriptDir = dirname(fileURLToPath(import.meta.url))
export const DAILY_SYNC_SCHEMA_PATH = join(scriptDir, '..', 'schemas', 'daily-sync-result.schema.json')

export interface MailItemInput {
  id: string
  receivedAt: string
  subject: string
  sender?: string
  summary?: string
  category?: string
  needsAction?: boolean
  deadline?: string
  status?: string
  company?: string
  position?: string
  sourceRef?: string
}

export interface SubmissionEntry {
  sourceRef: string
  company: string
  position?: string
  kind: string
  submittedAt: string
  result?: string
  detail?: string
}

export interface DailySyncResult {
  schemaVersion: 1
  generatedAt?: string
  selections: DiffItem[]
  mailItems: MailItemInput[]
  submissions: SubmissionEntry[]
  priorityMails?: { id?: string; subject: string; reason: string }[]
  notes?: string
}

/** JSON Schema検証。適合しなければ throw(=DBには一切触れない) */
export function validateDailySyncResult(
  value: unknown,
  schemaPath: string = DAILY_SYNC_SCHEMA_PATH,
): asserts value is DailySyncResult {
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'))
  const errors = validateJsonSchema(value, schema)
  if (errors.length) {
    throw new Error('抽出結果がschemaに一致しません:\n  ' + errors.slice(0, 12).join('\n  '))
  }
}

export interface DailySyncApplySummary {
  selections: { updated: string[]; added: string[]; skipped: string[]; pending: string[] }
  mail: { created: number; updated: number }
  submissions: { created: number; duplicate: number; errors: string[] }
  priorityMails: { subject: string; reason: string }[]
  notes?: string
}

/**
 * 検証済みの抽出結果を、渡された1つのDB接続へ反映する。
 * 選考差分・Inboxメール・提出結果をそれぞれ既存の入口(applyDiff / applyMail / applySubmission)に通す。
 * 提出物の1件が名寄せ不能等で失敗しても、他の反映は止めずエラーとして集約する。
 */
export function applyDailySyncResult(
  db: DatabaseSync,
  result: DailySyncResult,
  opts: { force?: boolean } = {},
): DailySyncApplySummary {
  if (result.selections.length > MAX_APPLY_CHANGES && !opts.force) {
    throw new Error(
      `選考差分が ${result.selections.length} 社あり上限 ${MAX_APPLY_CHANGES} 社を超えています。中止しました(内容が妥当なら --force)。`,
    )
  }
  const selections = applyDiff(db, result.selections)
  const mail = applyMail({ items: result.mailItems }, db)
  const submissions = { created: 0, duplicate: 0, errors: [] as string[] }
  for (const entry of result.submissions) {
    try {
      const res = applySubmission(entry, db)
      if (res.created) submissions.created += 1
      else submissions.duplicate += 1
    } catch (error) {
      submissions.errors.push(`${entry.company}/${entry.kind}: ${(error as Error).message}`)
    }
  }
  return {
    selections: {
      updated: selections.updated,
      added: selections.added,
      skipped: selections.skipped,
      pending: selections.pending,
    },
    mail,
    submissions,
    priorityMails: (result.priorityMails ?? []).map((p) => ({ subject: p.subject, reason: p.reason })),
    notes: result.notes,
  }
}

const invokedDirectly =
  process.argv[1] != null &&
  resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()

if (invokedDirectly) {
  const args = process.argv.slice(2)
  const file = args.find((a) => !a.startsWith('--'))
  if (!file) {
    console.error('使い方: npx tsx scripts/daily-sync-apply.ts <result.json> [--db <path>] [--force]')
    process.exit(1)
  }
  const dbArgIndex = args.indexOf('--db')
  const dbPath = resolveDatabasePath(dbArgIndex >= 0 ? args[dbArgIndex + 1] : undefined)

  const value: unknown = JSON.parse(readFileSync(resolve(file), 'utf8'))
  validateDailySyncResult(value)
  if (args.includes('--validate-only')) {
    console.log(JSON.stringify({ valid: true, schemaVersion: value.schemaVersion }, null, 2))
    process.exit(0)
  }
  const db = openDb(dbPath)
  const summary = applyDailySyncResult(db, value, { force: args.includes('--force') })

  console.log('daily-sync 反映:')
  console.log(
    `  選考: 更新 ${summary.selections.updated.length} / 追加 ${summary.selections.added.length}` +
      ` / 保留 ${summary.selections.skipped.length} / 名寄せ要確認 ${summary.selections.pending.length}`,
  )
  console.log(`  メール: 追加 ${summary.mail.created} / 更新 ${summary.mail.updated}`)
  console.log(
    `  提出結果: 追加 ${summary.submissions.created} / 既反映 ${summary.submissions.duplicate}` +
      (summary.submissions.errors.length ? ` / 失敗 ${summary.submissions.errors.length}` : ''),
  )
  if (summary.selections.pending.length) {
    console.log(`  名寄せ要確認(本人へ): ${summary.selections.pending.join('、')}`)
  }
  if (summary.submissions.errors.length) {
    for (const e of summary.submissions.errors) console.log(`  提出失敗: ${e}`)
  }
  if (summary.priorityMails.length) {
    console.log('  最優先メール(既読化せず要確認):')
    for (const p of summary.priorityMails) console.log(`    - ${p.subject}(${p.reason})`)
  }
  if (summary.notes) console.log(`  メモ: ${summary.notes}`)
}
