/** 個人情報を含まない集計CSV。Databricksへは自動送信しない。 */
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { aggregateFunnel, funnelCsv } from '../src/analytics-export.js'

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  console.log('使い方: npm run analytics:export -- --demo [--out 保存先.csv]\n' +
    '          npm run analytics:export -- --db 正本.db [--out 保存先.csv]\n' +
    '企業名・氏名・日時・自由記述は出力しません。外部送信は行いません。')
  process.exit(0)
}

let demo = false
let dbPath: string | undefined
let outPath = 'data/databricks/funnel.csv'
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--demo' && !demo) demo = true
  else if (args[i] === '--db' && !dbPath && args[i + 1] && !args[i + 1].startsWith('--')) dbPath = args[++i]
  else if (args[i] === '--out' && args[i + 1] && !args[i + 1].startsWith('--')) outPath = args[++i]
  else throw new Error('引数が不正です。--help を確認してください。')
}
if (demo === Boolean(dbPath)) throw new Error('--demo または --db の一方を指定してください。')

const db = demo ? new DatabaseSync(':memory:') : new DatabaseSync(resolve(dbPath!), { readOnly: true })
try {
  if (demo) {
    db.exec('CREATE TABLE selection (submitted INTEGER NOT NULL, status TEXT NOT NULL)')
    const insert = db.prepare('INSERT INTO selection (submitted, status) VALUES (?, ?)')
    for (const [submitted, status] of [
      [0, '検討中'], [0, '検討中'], [0, '検討中'], [1, '選考中'], [1, '選考中'],
      [1, '選考中'], [1, '合格'], [1, '合格'], [1, '不合格'], [1, '不合格'],
      [1, '辞退'], [1, '内定'],
    ] as Array<[number, string]>) insert.run(submitted, status)
  }
  const out = resolve(outPath)
  if (dbPath && existsSync(out) && realpathSync(out) === realpathSync(resolve(dbPath))) {
    throw new Error('保存先に正本DBを指定できません。')
  }
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, funnelCsv(aggregateFunnel(db)), { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  console.log(`集計CSVを作成しました: ${out}（外部送信なし）`)
} finally {
  db.close()
}
