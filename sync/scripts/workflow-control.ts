/**
 * workflow契約を実行時に強制するCLI。
 * 実行台帳は正本DBと分離した logs/workflow-runtime.local.db に置き、
 * runごとに対象の正本DB identity/roleを固定する。
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDatabaseContext, openDb, type DatabaseContext } from '../src/db'
import { resolveDatabasePath } from '../src/database-path'
import {
  beginWorkflowStep,
  completeWorkflowStep,
  decideWorkflowApproval,
  failWorkflowStep,
  getWorkflowRun,
  loadWorkflowContract,
  openWorkflowStore,
  requestWorkflowApproval,
  startWorkflowRun,
  type WorkflowOwner,
} from '../src/workflow-control'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = join(scriptDir, '..', '..')

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function required(name: string): string {
  const value = option(name)
  if (!value) throw new Error(`${name} は必須です`)
  return value
}

function parseValue(pathOrUndefined: string | undefined): unknown {
  if (!pathOrUndefined) return {}
  const text = readFileSync(resolve(pathOrUndefined), 'utf8')
  try { return JSON.parse(text) } catch { return text }
}

function workflowStorePath(): string {
  return resolve(option('--store') || process.env.KATAZUKU_WORKFLOW_DB ||
    join(repositoryRoot, 'logs', 'workflow-runtime.local.db'))
}

function targetDatabaseContext(): DatabaseContext {
  const db = openDb(resolveDatabasePath(option('--db')))
  try { return getDatabaseContext(db) } finally { db.close() }
}

function contractAndPath() {
  const path = resolve(required('--contract'))
  return { path, contract: loadWorkflowContract(path) }
}

const command = process.argv[2]
if (!command) throw new Error('commandが必要です')

if (command === 'step-config') {
  const { path, contract } = contractAndPath()
  const stepId = required('--step')
  const step = contract.steps.find((candidate) => candidate.id === stepId)
  if (!step) throw new Error(`stepがありません: ${stepId}`)
  console.log(JSON.stringify({
    workflowId: contract.id,
    contractVersion: contract.version,
    ...step,
    inputSchema: step.inputSchema ? resolve(dirname(path), step.inputSchema) : undefined,
    outputSchema: step.outputSchema ? resolve(dirname(path), step.outputSchema) : undefined,
    risk: step.sideEffect === 'none' ? 'read-only'
      : step.sideEffect === 'db-write' ? 'db-write'
      : step.sideEffect === 'external-draft' ? 'external-draft' : 'external-commit',
    sideEffectMode: step.sideEffect === 'none' ? 'none' : 'direct',
  }, null, 2))
  process.exit(0)
}

const { contract } = contractAndPath()
const store = openWorkflowStore(workflowStorePath())
try {
  const runId = required('--run-id')
  switch (command) {
    case 'start': {
      const result = startWorkflowRun(store, contract, parseValue(option('--input')), targetDatabaseContext(), runId)
      console.log(JSON.stringify(result, null, 2))
      break
    }
    case 'begin': {
      const stepId = required('--step')
      const step = contract.steps.find((candidate) => candidate.id === stepId)
      if (!step) throw new Error(`stepがありません: ${stepId}`)
      const owner = required('--owner') as WorkflowOwner
      const action = option('--action') ? parseValue(option('--action')) : undefined
      const result = beginWorkflowStep(store, contract, runId, stepId, owner, {
        input: option('--input') ? parseValue(option('--input')) : undefined,
        capabilities: step.capabilities,
        action,
        targetDatabase: targetDatabaseContext(),
      })
      console.log(JSON.stringify(result, null, 2))
      break
    }
    case 'complete': {
      const stepId = required('--step')
      const owner = required('--owner') as WorkflowOwner
      const outputPath = option('--output')
      const actionPath = option('--action')
      const result = completeWorkflowStep(store, contract, runId, stepId, owner, {
        output: outputPath ? parseValue(outputPath) : undefined,
        outputRef: outputPath ? resolve(outputPath) : '',
        action: actionPath ? parseValue(actionPath) : undefined,
        targetDatabase: targetDatabaseContext(),
      })
      console.log(JSON.stringify(result, null, 2))
      break
    }
    case 'fail': {
      const status = required('--status')
      if (status !== 'failed' && status !== 'unknown') throw new Error('--statusはfailedまたはunknownです')
      const result = failWorkflowStep(store, contract, runId, required('--step'),
        required('--owner') as WorkflowOwner, status, required('--error'))
      console.log(JSON.stringify(result, null, 2))
      break
    }
    case 'request-approval': {
      const result = requestWorkflowApproval(store, contract, runId, required('--step'),
        parseValue(required('--action')), targetDatabaseContext())
      console.log(JSON.stringify(result, null, 2))
      break
    }
    case 'approve':
    case 'reject': {
      const result = decideWorkflowApproval(store, contract, runId, required('--step'),
        parseValue(required('--action')), command === 'approve' ? 'approved' : 'rejected', targetDatabaseContext())
      console.log(JSON.stringify(result, null, 2))
      break
    }
    case 'status':
      console.log(JSON.stringify(getWorkflowRun(store, runId), null, 2))
      break
    default:
      throw new Error(
        '使用法: workflow-control.ts <start|step-config|begin|complete|fail|request-approval|approve|reject|status> ' +
        '--contract <json> --run-id <id> [--step <id>] [--owner <owner>] [--input/--output/--action <json>]',
      )
  }
} finally {
  store.close()
}
