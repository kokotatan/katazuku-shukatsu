/** 面談準備の全件再評価と、根拠に一致する成果物の保存。外部送信は行わない。 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { openDb, getDatabaseContext } from '../src/db'
import { resolveDatabasePath } from '../src/database-path'
import { blockMeetingPreparation, evaluateMeetingPreparation, saveMeetingPreparation } from '../src/meeting-preparation'

const args = process.argv.slice(2)
const command = args[0] ?? 'list'
const option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] ?? '' : '' }
const db = openDb(resolveDatabasePath(option('--db') || undefined))
if (command === 'apply') {
  if (!args[1]) throw new Error('使い方: meeting-preparation.ts apply <JSON>')
  saveMeetingPreparation(db, JSON.parse(readFileSync(resolve(args[1]), 'utf8').replace(/^\uFEFF/, '')))
} else if (command === 'block') {
  blockMeetingPreparation(db, Number(option('--id')), option('--reason'))
} else if (!['list', 'check'].includes(command)) throw new Error(`未知のcommand: ${command}`)
const all = evaluateMeetingPreparation(db)
const items = all.filter(a => a.status !== 'ready')
const doc = { generatedAt: new Date().toISOString(), database: getDatabaseContext(db), pendingCount: items.length, readyCount: all.length - items.length, items }
const json = JSON.stringify(doc, null, 2)
if (option('--write')) writeFileSync(resolve(option('--write')), json + '\n', 'utf8')
if (option('--alert')) {
  const path = resolve(option('--alert'))
  if (items.length) writeFileSync(path, `面談準備が未完了: ${items.length}件\n` + items.map(a => `${a.at} ${a.company}: ${a.reasons.join(' / ')}`).join('\n') + '\n', 'utf8')
  else if (existsSync(path)) rmSync(path)
}
// 全文は作業ファイルへ保存し、定期処理のログ・agent文脈を同じ会社の情報で埋め尽くさない。
console.log(option('--write') ? JSON.stringify({ ...doc, items: items.map(a => ({
  appointmentId: a.appointmentId, company: a.company, position: a.position, at: a.at,
  contextHash: a.contextHash, reasons: a.reasons,
})), contextFile: resolve(option('--write')) }, null, 2) : json)
db.close()
if (command === 'check' && items.length) process.exitCode = 2
