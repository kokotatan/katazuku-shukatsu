import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { SparkQueue } from '../src/spark-queue.js'

const repo = fileURLToPath(new URL('../', import.meta.url))
const queue = new SparkQueue(resolve(repo, 'logs/spark-queue.local.db'))
const [command, a, b, c] = process.argv.slice(2)
try {
  let result: unknown
  if (command === 'enqueue' && a && b && c) result = queue.enqueue(a, b, readFileSync(resolve(repo, c), 'utf8'))
  else if (command === 'status' && a) result = queue.status(a)
  else if (command === 'list') result = queue.list()
  else if (command === 'reconcile' && a && b) result = queue.reconcile(a, b)
  else throw new Error('使い方: spark-queue.ts enqueue <一意キー> <用途> <入力.txt> | status <runId> | list | reconcile <runId> <SparkタスクURL>')
  console.log(JSON.stringify(result, null, 2))
} finally { queue.close() }
