import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  activateApprovedCandidate, approveCandidate, getHarnessRelease, harnessImprovementSummary,
  ingestAgentRunArtifacts, openHarnessImprovementStore, registerHarnessBaseline, rollbackHarnessRelease,
  recordCandidateEvaluation, recordImprovementProposal, type HarnessEvalCase, type ImprovementProposal,
} from '../src/harness-improvement.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const command = args[0] || 'report'
const valueAfter = (flag: string) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined }
const storePath = resolve(valueAfter('--store') || process.env.KATAZUKU_HARNESS_STORE || join(root, 'logs', 'harness-improvement.local.db'))
const readJson = (path: string): unknown => {
  const absolute = resolve(path)
  if (!existsSync(absolute)) throw new Error('入力JSONが見つかりません')
  const content = readFileSync(absolute, 'utf8')
  if (Buffer.byteLength(content) > 1_048_576) throw new Error('入力JSONが大きすぎます')
  return JSON.parse(content)
}

mkdirSync(dirname(storePath), { recursive: true })
const db = openHarnessImprovementStore(storePath)
try {
  if (command === 'scan') {
    const artifactDir = resolve(valueAfter('--artifacts') || join(root, 'logs', 'agent-runs'))
    const result = await ingestAgentRunArtifacts(db, artifactDir)
    console.log(JSON.stringify({ ...result, summary: harnessImprovementSummary(db) }, null, 2))
  } else if (command === 'report') {
    console.log(JSON.stringify(harnessImprovementSummary(db), null, 2))
  } else if (command === 'propose') {
    const file = args[1]
    if (!file || file.startsWith('--')) throw new Error('proposeには候補JSONが必要です')
    console.log(JSON.stringify(recordImprovementProposal(db, readJson(file) as ImprovementProposal)))
  } else if (command === 'evaluate') {
    const candidateId = args[1]
    const file = args[2]
    if (!candidateId || !file) throw new Error('evaluateにはcandidateIdとeval JSONが必要です')
    const cases = readJson(file)
    if (!Array.isArray(cases)) throw new Error('eval JSONは配列です')
    console.log(JSON.stringify(recordCandidateEvaluation(db, candidateId, cases as HarnessEvalCase[]), null, 2))
  } else if (command === 'approve') {
    const candidateId = args[1]
    const revision = args[2]
    const approvedBy = valueAfter('--approved-by')
    if (!candidateId || !revision || !approvedBy) throw new Error('approveにはcandidateId、revision、--approved-byが必要です')
    approveCandidate(db, candidateId, approvedBy, revision)
    console.log(JSON.stringify({ approved: true, candidateId, revision }))
  } else if (command === 'baseline') {
    const revision = args[1]
    const registeredBy = valueAfter('--registered-by')
    if (!revision || !registeredBy) throw new Error('baselineにはrevisionと--registered-byが必要です')
    console.log(JSON.stringify(registerHarnessBaseline(db, revision, registeredBy), null, 2))
  } else if (command === 'activate') {
    const candidateId = args[1]
    const expectedRevision = valueAfter('--expected-revision')
    const activatedBy = valueAfter('--activated-by')
    if (!candidateId || !expectedRevision || !activatedBy) throw new Error('activateにはcandidateId、--expected-revision、--activated-byが必要です')
    console.log(JSON.stringify(activateApprovedCandidate(db, candidateId, activatedBy, expectedRevision), null, 2))
  } else if (command === 'rollback') {
    const expectedRevision = valueAfter('--expected-revision')
    const rolledBackBy = valueAfter('--rolled-back-by')
    const reason = valueAfter('--reason')
    if (!expectedRevision || !rolledBackBy || !reason) throw new Error('rollbackには--expected-revision、--rolled-back-by、--reasonが必要です')
    console.log(JSON.stringify(rollbackHarnessRelease(db, expectedRevision, rolledBackBy, reason), null, 2))
  } else if (command === 'release') {
    console.log(JSON.stringify(getHarnessRelease(db) || null, null, 2))
  } else throw new Error(`未知のcommandです: ${command}`)
} finally { db.close() }
