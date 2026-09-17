/** 正本から非公開のdata/snapshot.jsonへ書き出す。public/には個人データを置かない。 */
import { existsSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { buildSnapshot } from '../src/snapshot.js'
import { MAX_SNAPSHOT_BYTES } from '../src/snapshot-contract.js'
import { desktopConfig } from '../src/desktop-config.js'

function main() {
  const args = process.argv.slice(2)
  if (args.some(arg => arg.startsWith('--'))) throw new Error('架空データの生成は行いません。npm run snapshot [正本DBのパス] を使用してください')
  if (args.length > 1) throw new Error('正本DBのパスは1つだけ指定してください')
  const path = resolve(args[0] ?? process.env.KATAZUKU_DB ?? desktopConfig()?.database ?? 'data/katazuku.db')
  if (!existsSync(path)) throw new Error('正本DBがありません。先にPCの初期設定を行ってください')
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    const snapshot = buildSnapshot(db)
    const body = JSON.stringify(snapshot)
    if (Buffer.byteLength(body) > MAX_SNAPSHOT_BYTES) throw new Error('閲覧データが同期できるサイズを超えています')
    const output = resolve('data/snapshot.json')
    const temporary = `${output}.${randomUUID()}.tmp`
    mkdirSync(dirname(output), { recursive: true, mode: 0o700 })
    try { writeFileSync(temporary, body, { encoding: 'utf8', mode: 0o600, flag: 'wx' }); renameSync(temporary, output) }
    finally { rmSync(temporary, { force: true }) }
    console.log('閲覧データを data/snapshot.json に更新しました。画面には認証付きAPIで配信します。')
  } finally { db.close() }
}

try { main() } catch (error) {
  console.error(error instanceof Error ? error.message : '閲覧データを生成できませんでした')
  process.exitCode = 1
}
