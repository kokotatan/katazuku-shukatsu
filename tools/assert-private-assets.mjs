#!/usr/bin/env node
/** gitignoreとは別に、配信される実ファイルを検査する。疑わしい内容自体は出力しない。 */
import { readFileSync, readdirSync, lstatSync, existsSync } from 'node:fs'
import { resolve, relative, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const APP_NAMES = ['board', 'status', 'inbox', 'insight', 'profile', 'people', 'prep', 'impact']
const root = fileURLToPath(new URL('../', import.meta.url))
const branding = new Set(['icons/favicon-16.png', 'icons/favicon-32.png', 'icons/necktie-192.png', 'icons/necktie-512.png', 'icons/necktie-apple-touch.png'])
const forbiddenName = /(?:^|\/)(?:data|logs|credentials|credential-store)(?:\/|$)|snapshot|\.db(?:-|$)|\.sqlite(?:3)?(?:-|$)|\.env(?:\.|$)|\.local\.|service-account|oauth.*(?:token|credential)/i
const credentialValue = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{20,}|\bAKIA[0-9A-Z]{16}\b|\bAIza[0-9A-Za-z_-]{35}\b|\bxox[baprs]-[0-9A-Za-z-]{10,}\b/
const snapshotBody = /"(?:selections|mailItems|enrichedEvents|profileSuggestions)"\s*:\s*\[/

export function assertPublicAssets(directory, { source = false } = {}) {
  const base = resolve(directory)
  if (!existsSync(base)) return 0
  if (lstatSync(base).isSymbolicLink()) throw new Error('公開フォルダにシンボリックリンクを使用できません')
  let count = 0
  function walk(folder) {
    for (const entry of readdirSync(folder)) {
      const path = join(folder, entry)
      const name = relative(base, path).replaceAll('\\', '/')
      const info = lstatSync(path)
      if (info.isSymbolicLink()) throw new Error(`配信物にシンボリックリンクがあります: ${name}`)
      if (forbiddenName.test(name)) throw new Error(`個人データを配信できません: ${name}`)
      if (info.isDirectory()) { walk(path); continue }
      if (!info.isFile() || ++count > 20_000 || info.size > 64 * 1024 * 1024) throw new Error('配信物の形式またはサイズが不正です')
      const appPath = name.replace(/^(?:board|status|inbox|insight|profile|people|prep|impact)\//, '')
      if (source && !branding.has(appPath)) throw new Error(`publicには確認済みのブランド素材だけを配置してください: ${name}`)
      if (!source && !branding.has(appPath) && !['.html', '.js', '.css', '.webmanifest', '.map', '.txt'].includes(extname(name))) throw new Error(`未確認のファイルを配信できません: ${name}`)
      if (['.html', '.js', '.css', '.json', '.webmanifest', '.map', '.txt'].includes(extname(name))) {
        const contents = readFileSync(path, 'utf8')
        if (credentialValue.test(contents) || snapshotBody.test(contents)) throw new Error(`配信物に個人データまたは認証値の疑いがあります: ${name}`)
      }
    }
  }
  walk(base)
  return count
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    let count = 0
    for (const app of APP_NAMES) {
      count += assertPublicAssets(join(root, app, 'public'), { source: true })
      count += assertPublicAssets(join(root, app, 'dist'))
    }
    count += assertPublicAssets(join(root, 'web-dist'))
    console.log(`配信データ境界: ${count}ファイルを確認`)
  } catch (error) { console.error(error instanceof Error ? error.message : '配信物の検査に失敗'); process.exitCode = 1 }
}
