import type { DatabaseSync } from 'node:sqlite'
import { listSubmissionRequirements, type SubmissionRequirementRow } from './submission-requirement'

export type ReadinessSeverity = 'overdue' | 'urgent' | 'due_soon' | 'prepare' | 'awaiting_approval' | 'blocked'

export interface SubmissionReadinessItem extends SubmissionRequirementRow {
  severity: ReadinessSeverity
  hoursUntilDeadline: number | null
  requiredAction: string
}

function parseDeadline(value: string): number | null {
  if (!value) return null
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  const timestamp = dateOnly
    ? Date.parse(`${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}T23:59:00+09:00`)
    : Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

export function evaluateSubmissionReadiness(
  db: DatabaseSync,
  now: Date = new Date(),
): SubmissionReadinessItem[] {
  return listSubmissionRequirements(db, { openOnly: true }).map((row) => {
    const deadline = parseDeadline(row.deadline)
    const hours = deadline === null ? null : (deadline - now.getTime()) / 3_600_000
    let severity: ReadinessSeverity
    let requiredAction: string
    if (row.preparationStatus === 'ready_for_approval') {
      severity = 'awaiting_approval'
      requiredAction = '準備済み内容を本人へ提示し、最終承認を受ける'
    } else if (row.preparationStatus === 'blocked') {
      severity = 'blocked'
      requiredAction = `阻害要因を解消する${row.blocker ? `: ${row.blocker}` : ''}`
    } else if (hours !== null && hours < 0) {
      severity = 'overdue'
      requiredAction = '期限超過として即時エスカレーションし、代替提出または期限延長を準備する'
    } else if (hours !== null && hours <= 48) {
      severity = 'urgent'
      requiredAction = '公式手続先を確認し、成果物またはフォームを最終承認直前まで準備する'
    } else if (hours !== null && hours <= 7 * 24) {
      severity = 'due_soon'
      requiredAction = '今日中に公式手続先を確認し、成果物またはフォームを準備する'
    } else {
      severity = 'prepare'
      requiredAction = '受信時点で公式手続先・必要項目・添付物を調べ、前倒しで準備する'
    }
    return { ...row, severity, hoursUntilDeadline: hours, requiredAction }
  })
}
