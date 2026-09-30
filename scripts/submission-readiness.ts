/**
 * 未完了提出物の決定論ガード。
 *
 * processed 済みメールや未読状態に依存せず、正本DBの submission_requirement を毎回全件再評価する。
 * 外部への提出は行わない。mark は「本人の最終承認だけが残る」などの準備状態を記録するだけ。
 *
 *   npx tsx scripts/submission-readiness.ts list [--write <json>] [--alert <txt>] [--now <ISO>]
 *   npx tsx scripts/submission-readiness.ts mark --id <id> --status <researching|ready_for_approval|blocked> [--ref <path>] [--blocker <理由>]
 *   npx tsx scripts/submission-readiness.ts complete --id <id> --ref <提出完了の根拠(メールID等)>
 */
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { openDb } from '../src/db.js'
import { resolveDatabasePath } from '../src/database-path.js'
import { evaluateSubmissionReadiness } from '../src/submission-readiness.js'
import { completeRequirement, setRequirementPreparation, type PreparationStatus } from '../src/submission-requirement.js'

/** 台帳を再評価して JSON と(必要なら)要対応のアラートを書く。ワークフローから直接呼ぶ入口。 */
export function writeSubmissionReadiness(db: DatabaseSync, options: { write?: string; alert?: string; now?: Date } = {}): string {
  const now = options.now ?? new Date()
  const items = evaluateSubmissionReadiness(db, now)
  const json = JSON.stringify({
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    unresolvedCount: items.length,
    urgentCount: items.filter((item) => ['overdue', 'urgent', 'blocked'].includes(item.severity)).length,
    items,
  }, null, 2)
  if (options.write) writeFileSync(resolve(options.write), json + '\n', 'utf8')
  if (options.alert) {
    const target = resolve(options.alert)
    if (items.length) {
      const lines = items.slice(0, 10).map((item) =>
        `[${item.severity}] ${item.company || '会社未特定'} / ${item.title}${item.deadline ? ` / 締切=${item.deadline}` : ''} / ${item.requiredAction}`)
      writeFileSync(target, `未完了提出物 ${items.length}件\n${lines.join('\n')}\n`, 'utf8')
    } else if (existsSync(target)) {
      rmSync(target)
    }
  }
  return json
}

const invokedDirectly = process.argv[1] != null && resolve(process.argv[1]).toLowerCase().endsWith('submission-readiness.ts')
if (invokedDirectly) {
  const args = process.argv.slice(2)
  const command = !args[0] || args[0].startsWith('--') ? 'list' : args[0]
  const value = (name: string): string => {
    const index = args.indexOf(name)
    return index >= 0 ? args[index + 1] ?? '' : ''
  }
  const db = openDb(resolveDatabasePath(value('--db') || undefined))
  try {
    if (command === 'mark') {
      const id = Number(value('--id'))
      const status = value('--status') as PreparationStatus
      if (!Number.isInteger(id) || !['not_started', 'researching', 'ready_for_approval', 'blocked'].includes(status)) {
        throw new Error('使い方: submission-readiness.ts mark --id <id> --status <researching|ready_for_approval|blocked> [--ref <path>] [--blocker <理由>]')
      }
      setRequirementPreparation(db, id, status as Exclude<PreparationStatus, 'done'>, { preparationRef: value('--ref'), blocker: value('--blocker') })
      console.log(JSON.stringify({ updated: true, id, status }, null, 2))
    } else if (command === 'complete') {
      const id = Number(value('--id'))
      const ref = value('--ref')
      if (!Number.isInteger(id) || !ref) throw new Error('使い方: submission-readiness.ts complete --id <id> --ref <根拠>')
      completeRequirement(db, id, ref)
      console.log(JSON.stringify({ completed: true, id, ref }, null, 2))
    } else if (command === 'list') {
      const nowArg = value('--now')
      const now = nowArg ? new Date(nowArg) : new Date()
      if (Number.isNaN(now.getTime())) throw new Error(`不正な --now: ${nowArg}`)
      console.log(writeSubmissionReadiness(db, { write: value('--write') || undefined, alert: value('--alert') || undefined, now }))
    } else {
      throw new Error(`未知のコマンド: ${command}`)
    }
  } finally {
    db.close()
  }
}
