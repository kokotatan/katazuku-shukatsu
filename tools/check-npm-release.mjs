#!/usr/bin/env node
/**
 * npm公開前の不変条件を検査する。
 * 引数にタグを渡した場合は package.json の version と一致することも確認する。
 */
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const releaseTag = process.argv[2]
const expectedRepository = 'git+https://github.com/kokotatan/katazuku-shukatsu.git'
const failures = []

if (pkg.name !== 'katazuku-shukatsu') failures.push(`package名が不正です: ${pkg.name}`)
if (pkg.private === true) failures.push('private=true のため公開できません')
if (pkg.publishConfig?.access !== 'public') failures.push('publishConfig.access は public が必要です')
if (pkg.repository?.url !== expectedRepository) {
  failures.push(`repository.url が公開リポジトリと一致しません: ${pkg.repository?.url ?? '(未設定)'}`)
}
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version)) {
  failures.push(`version がSemVer形式ではありません: ${pkg.version}`)
}
if (releaseTag && releaseTag !== `v${pkg.version}`) {
  failures.push(`タグ ${releaseTag} と package.json の v${pkg.version} が一致しません`)
}

if (failures.length) {
  console.error('npm公開前検査に失敗しました:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`npm公開前検査OK: ${pkg.name}@${pkg.version}${releaseTag ? ` (${releaseTag})` : ''}`)
