/**
 * 未完了提出物の決定論ガード。
 *
 * processed済みメールや未読状態に依存せず、正本DBのsubmission_requirementを毎回全件再評価する。
 * 外部提出は行わない。mark-readyは「本人の最終承認だけが残る」状態を記録するだけ。
 */
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { openDb } from '../src/db'
import { resolveDatabasePath } from '../src/database-path'
import { evaluateSubmissionReadiness } from '../src/submission-readiness'
import {
  completeRequirement,
  setRequirementPreparation,
  type PreparationStatus,
} from '../src/submission-requirement'

const args = process.argv.slice(2)
const command = args[0]?.startsWith('--') || !args[0] ? 'list' : args[0]
const value = (name: string): string => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] ?? '' : ''
}
const dbPath = resolveDatabasePath(value('--db') || undefined)
const db = openDb(dbPath)

if (command === 'mark') {
  const id = Number(value('--id'))
  const status = value('--status') as PreparationStatus
  if (!Number.isInteger(id) || !['not_started', 'researching', 'ready_for_approval', 'blocked'].includes(status)) {
    throw new Error('使い方: submission-readiness.ts mark --id <id> --status <researching|ready_for_approval|blocked> [--ref <path>] [--blocker <理由>]')
  }
  setRequirementPreparation(db, id, status as Exclude<PreparationStatus, 'done'>, {
    preparationRef: value('--ref'),
    blocker: value('--blocker'),
  })
  console.log(JSON.stringify({ updated: true, id, status }, null, 2))
  process.exit(0)
}

if (command === 'complete') {
  const id = Number(value('--id'))
  const ref = value('--ref')
  if (!Number.isInteger(id) || !ref) throw new Error('使い方: submission-readiness.ts complete --id <id> --ref <送信済みメールID等>')
  completeRequirement(db, id, ref)
  console.log(JSON.stringify({ completed: true, id, ref }, null, 2))
  process.exit(0)
}

if (command !== 'list') throw new Error(`未知のcommand: ${command}`)

const nowArg = value('--now')
const now = nowArg ? new Date(nowArg) : new Date()
if (Number.isNaN(now.getTime())) throw new Error(`不正な --now: ${nowArg}`)
const items = evaluateSubmissionReadiness(db, now)
const document = {
  schemaVersion: 1,
  generatedAt: now.toISOString(),
  unresolvedCount: items.length,
  urgentCount: items.filter((item) => ['overdue', 'urgent', 'blocked'].includes(item.severity)).length,
  items,
}
const json = JSON.stringify(document, null, 2)
const writePath = value('--write')
if (writePath) writeFileSync(resolve(writePath), json + '\n', 'utf8')
const alertPath = value('--alert')
if (alertPath) {
  const target = resolve(alertPath)
  if (items.length) {
    const summary = items.slice(0, 10).map((item) =>
      `[${item.severity}] ${item.company || '会社未特定'} / ${item.title}` +
      `${item.deadline ? ` / 締切=${item.deadline}` : ''} / ${item.requiredAction}`,
    )
    writeFileSync(target, `未完了提出物 ${items.length}件\n${summary.join('\n')}\n`, 'utf8')
  } else if (existsSync(target)) {
    rmSync(target)
  }
}
console.log(json)
