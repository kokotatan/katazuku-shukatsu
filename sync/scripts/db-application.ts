/**
 * 応募自動運転のrunを開始・更新・確認するCLI。
 *
 * 書き込み後はリポジトリ直下で定めた db-snapshot.ts を別途実行すること。
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb } from '../src/db'
import {
  applyApplicationEvent,
  listApplicationRuns,
  listWebAssessments,
  startApplication,
  type ApplicationEventInput,
  type StartApplicationInput,
} from '../src/application'

const dbArgIndex = process.argv.indexOf('--db')
const DB_PATH = dbArgIndex >= 0
  ? resolve(process.argv[dbArgIndex + 1])
  : (process.env.KATAZUKU_DB_PATH || join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'katazuku.db'))

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(resolve(path), 'utf8'))
}

function inputPath(): string {
  const args = process.argv.slice(3)
  const clean = args.filter((arg, index) => arg !== '--db' && args[index - 1] !== '--db')
  if (!clean[0]) throw new Error('JSONファイルを指定してください')
  return clean[0]
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && currentFile === resolve(process.argv[1])) {
  const command = process.argv[2]
  const db = openDb(DB_PATH)
  try {
    switch (command) {
      case 'start': {
        const value = readJson(inputPath()) as StartApplicationInput
        console.log(JSON.stringify(startApplication(db, value), null, 2))
        break
      }
      case 'event': {
        const value = readJson(inputPath())
        const events = (Array.isArray(value) ? value : [value]) as ApplicationEventInput[]
        console.log(JSON.stringify(events.map((event) => applyApplicationEvent(db, event)), null, 2))
        break
      }
      case 'list':
        console.log(JSON.stringify(listApplicationRuns(db), null, 2))
        break
      case 'assessments':
        console.log(JSON.stringify(listWebAssessments(db), null, 2))
        break
      default:
        throw new Error(
          '使い方: npx tsx scripts/db-application.ts ' +
          '<start <start.json>|event <event.json>|list|assessments> [--db <path>]',
        )
    }
  } finally {
    db.close()
  }
}
