#!/usr/bin/env node
/**
 * doctor: 実行環境が katazuku-shukatsu を動かせるか診断する。
 * clone 直後に `npm run doctor` で、動かない原因を先回りで示す。
 */
const problems = []
const notes = []

// 1) Node バージョン(node:sqlite は 22.5 で追加・24 で安定)
const [maj, min] = process.versions.node.split('.').map(Number)
const nodeOk = maj > 22 || (maj === 22 && min >= 5)
if (!nodeOk) problems.push(`Node ${process.versions.node} は非対応。22.5 以上(推奨 24)を使ってください。`)
else if (maj < 24) notes.push(`Node ${process.versions.node}: node:sqlite は experimental 扱い。警告が出ますが動作します(推奨 24)。`)

// 2) node:sqlite が読めるか(Node 22 では --experimental-sqlite が要る場合がある)
let sqliteOk = false
try {
  const m = await import('node:sqlite')
  sqliteOk = typeof m.DatabaseSync === 'function'
  if (sqliteOk) {
    const db = new m.DatabaseSync(':memory:')
    db.exec('CREATE TABLE t(x)'); db.prepare('INSERT INTO t VALUES (1)').run()
    const row = db.prepare('SELECT x FROM t').get()
    if (!row || row.x !== 1) problems.push('node:sqlite が読めましたが、簡単なクエリが失敗しました。')
    db.close?.()
  } else problems.push('node:sqlite は読めましたが DatabaseSync がありません。')
} catch (e) {
  problems.push(`node:sqlite を読み込めません: ${e.message}\n    → Node 22 系では NODE_OPTIONS=--experimental-sqlite が必要な場合があります。Node 24 を推奨します。`)
}

// 3) 環境情報
console.log('katazuku-shukatsu doctor')
console.log(`  platform : ${process.platform} (${process.arch})`)
console.log(`  node     : ${process.versions.node}`)
console.log(`  sqlite   : ${sqliteOk ? 'ok (node:sqlite)' : 'NG'}`)

for (const n of notes) console.log(`  note     : ${n}`)
if (problems.length) {
  console.error('\n問題:')
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}
console.log('\n診断OK: この環境で動かせます。`npm test` / `npm run seed` を試してください。')
