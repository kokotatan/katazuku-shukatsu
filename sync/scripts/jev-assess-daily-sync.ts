/**
 * daily-sync抽出JSONをJevでセカンドチェックする。DB更新・既読化・送信は行わない。
 * 実行には、外部送信を明示する --allow-external と TYPESAFE_API_KEY の両方が必要。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assessDailySyncMails, TypeSafeJevMailEvaluator } from '../src/jev-decision'
import { validateDailySyncResult, type DailySyncResult } from './daily-sync-apply'

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

const args = process.argv.slice(2)
const inputPath = args.find((arg) => !arg.startsWith('--'))
if (!inputPath) {
  console.error('使い方: npx tsx scripts/jev-assess-daily-sync.ts <daily-sync.json> --allow-external [--output <path>]')
  process.exit(1)
}
if (!args.includes('--allow-external')) {
  console.error('Jevへ抽出済みメール情報を送るため --allow-external が必要です')
  process.exit(2)
}
if (!process.env.TYPESAFE_API_KEY?.trim()) {
  console.error('TYPESAFE_API_KEY が設定されていません')
  process.exit(2)
}

const input = JSON.parse(readFileSync(resolve(inputPath), 'utf8')) as DailySyncResult
validateDailySyncResult(input)
const result = await assessDailySyncMails(input.mailItems, new TypeSafeJevMailEvaluator())
const json = JSON.stringify(result, null, 2) + '\n'
const outputPath = valueAfter(args, '--output')
if (outputPath) writeFileSync(resolve(outputPath), json, 'utf8')
else process.stdout.write(json)
