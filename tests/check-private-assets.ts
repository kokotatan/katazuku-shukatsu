import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// @ts-expect-error 実行時のNode用検査。外部ライブラリは追加しない。
import { assertPublicAssets } from '../tools/assert-private-assets.mjs'
import { openDb } from '../src/db.js'
import { saveBasicProfile } from '../src/platform.js'
import { buildSnapshot } from '../src/snapshot.js'
import { validateSnapshot } from '../src/snapshot-contract.js'

let passed = 0
function check(label: string, run: () => void) { run(); passed++; console.log(`OK ${label}`) }
const base = mkdtempSync(join(tmpdir(), 'katazuku-assets-'))
function fileCase(name: string, contents: string, source = false) {
  const folder = mkdtempSync(join(base, 'case-'))
  mkdirSync(join(folder, name, '..'), { recursive: true })
  writeFileSync(join(folder, name), contents)
  return () => assertPublicAssets(folder, { source })
}
try {
  check('publicのsnapshotを拒否', () => assert.throws(fileCase('snapshot.json', '{}', true)))
  check('生成済みの配信物でもsnapshotを拒否', () => assert.throws(fileCase('board/snapshot.json', '{}')))
  check('DB・環境変数・ローカルログを拒否', () => {
    for (const name of ['data/state.txt', 'private.db', '.env', 'report.local.md', 'logs/report.txt']) assert.throws(fileCase(name, '{}'))
  })
  check('別名のJavaScriptに埋めたデータも拒否', () => assert.throws(fileCase('assets/main.js', 'const data={"selections":[]}')))
  check('未確認の画像をpublicへ追加できない', () => assert.throws(fileCase('photo.png', '', true)))
  check('認証値の形を含む配信物を拒否', () => assert.throws(fileCase('assets/main.js', 'const key="' + 'ghp_' + 'x'.repeat(32) + '"')))
  check('コードとブランド素材は通す', () => { fileCase('index.html', '<main>接続先を設定</main>')(); fileCase('icons/necktie-192.png', '', true)() })
  check('公開フォルダから別の場所へのリンクを拒否', () => {
    const folder = mkdtempSync(join(base, 'link-')); const target = mkdtempSync(join(base, 'private-'))
    symlinkSync(target, join(folder, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    assert.throws(() => assertPublicAssets(folder))
  })
  const db = openDb(':memory:')
  try {
    check('空のDBから架空のレコードを補わない', () => {
      const snapshot = buildSnapshot(db)
      assert.equal(snapshot.schemaVersion, 1); assert.deepEqual(snapshot.selections, []); assert.ok(!('demo' in snapshot))
    })
    check('自由項目に混ざった認証値を閲覧用へ出さない', () => {
      saveBasicProfile(db, { strengths: 'テスト用の記録', details: { password: 'test-only', refresh_token: 'test-only' } }, 'check')
      const snapshot = buildSnapshot(db); assert.ok(!JSON.stringify(snapshot).includes('test-only'))
      assert.equal((snapshot.profile as Record<string, unknown>).strengths, 'テスト用の記録')
    })
    check('不正な版・欠けた一覧・認証値の入った同期を拒否', () => {
      const snapshot = buildSnapshot(db)
      for (const change of [{ schemaVersion: 99 }, { mailItems: 'invalid' }, { profile: { password: 'test-only' } }, { demo: true }]) assert.throws(() => validateSnapshot({ ...snapshot, ...change }))
    })
  } finally { db.close() }
} finally {
  // この検査でmkdtempした一時フォルダだけを回収する。
  assert.ok(base.startsWith(join(tmpdir(), 'katazuku-assets-')))
  rmSync(base, { recursive: true, force: true })
}
console.log(`配信データ境界: ${passed}項目成功`)
