import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSparkJob, sparkPrompt, validateSparkResponse, type SparkJob } from '../src/spark-handoff.js'

const repo = fileURLToPath(new URL('../', import.meta.url))
const root = join(repo, 'logs', 'spark-handoff')
const [command, arg, file] = process.argv.slice(2)
if (command === 'prepare' && arg && file) {
  const job = createSparkJob(arg, readFileSync(resolve(repo, file), 'utf8'))
  const dir = join(root, job.runId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'job.json'), JSON.stringify(job, null, 2), { flag: 'wx' })
  writeFileSync(join(dir, 'prompt.txt'), sparkPrompt(job), { flag: 'wx' })
  console.log(JSON.stringify({ runId: job.runId, prompt: join(dir, 'prompt.txt'), expiresAt: job.expiresAt, transport: 'browser', status: 'awaiting_spark' }))
} else if (command === 'receive' && arg && file) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(arg)) throw new Error('runIdが不正です')
  const dir = join(root, arg)
  const job: SparkJob = JSON.parse(readFileSync(join(dir, 'job.json'), 'utf8'))
  if (job.runId !== arg) throw new Error('runIdが一致しません')
  const payload = validateSparkResponse(job, readFileSync(resolve(repo, file), 'utf8'))
  const result = { version: 1, provider: 'gemini-spark', runId: arg, inputHash: job.inputHash, receivedAt: new Date().toISOString(), status: 'needs_review', payload }
  // 排他的作成により同一runへの二重受領・結果差替えを拒否する。
  writeFileSync(join(dir, 'received.json'), JSON.stringify(result, null, 2), { flag: 'wx' })
  console.log(JSON.stringify({ status: 'needs_review', result: join(dir, 'received.json'), dbApplied: false, externalCommitted: false }))
} else {
  throw new Error('使い方: spark-handoff.ts prepare <research|daily-sync|meeting-prep|document|reply-draft> <入力.txt> / receive <runId> <応答.json>')
}
