import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

let failures = 0
function check(name: string, ok: boolean): void {
  if (ok) console.log(`ok - ${name}`)
  else { console.error(`not ok - ${name}`); failures += 1 }
}

const scanner = resolve('tools/scan-secrets.mjs')
const work = mkdtempSync(join(tmpdir(), 'katazuku-scan-'))

try {
  const git = (...args: string[]) => spawnSync('git', args, { cwd: work, encoding: 'utf8' })
  check('検査用Gitリポジトリを作れる', git('init', '-q').status === 0)

  writeFileSync(join(work, 'safe.txt'), 'synthetic fixture only\n')
  check('安全なファイルを追跡できる', git('add', 'safe.txt').status === 0)
  const safe = spawnSync(process.execPath, [scanner, work], { encoding: 'utf8' })
  check('安全な追跡ファイルは通す', safe.status === 0)

  writeFileSync(join(work, 'disguised.bin'), Buffer.from('SQLite format 3\0synthetic'))
  writeFileSync(join(work, 'empty.sqlite3'), '')
  check('偽装DBを追跡できる', git('add', 'disguised.bin', 'empty.sqlite3').status === 0)
  const unsafe = spawnSync(process.execPath, [scanner, work], { encoding: 'utf8' })
  const report = `${unsafe.stdout}${unsafe.stderr}`
  check('SQLiteヘッダを持つ追跡ファイルを拒否する', unsafe.status === 1 && report.includes('disguised.bin') && report.includes('SQLiteデータベース'))
  check('DB拡張子を持つ追跡ファイルを拒否する', unsafe.status === 1 && report.includes('empty.sqlite3') && report.includes('データベース用拡張子'))
} finally {
  rmSync(work, { recursive: true, force: true })
}

if (failures) process.exit(1)
console.log('scan-secrets tests passed')
