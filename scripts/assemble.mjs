// 配信用 dist/ を組み立てる:
//   dist/           ← landing/ (katazuku.kotalab.com のトップ)
//   dist/inbox/     ← inbox/dist (Katazuku Inbox)
//   dist/pipeline/  ← pipeline/dist (Katazuku Pipeline)
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dist = join(root, 'dist')
const apps = ['inbox', 'pipeline']

for (const app of apps) {
  if (!existsSync(join(root, app, 'dist'))) {
    console.error(`${app}/dist がありません。先に ${app} をビルドしてください。`)
    process.exit(1)
  }
}

rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })
cpSync(join(root, 'landing'), dist, { recursive: true })
for (const app of apps) {
  cpSync(join(root, app, 'dist'), join(dist, app), { recursive: true })
}
// 個人メールデータ(ローカル自動取込用)は配信物に絶対に含めない
rmSync(join(dist, 'inbox', 'gmail-import-auto.json'), { force: true })
console.log(`✓ dist/ を組み立てました (landing + ${apps.map((a) => `/${a}`).join(' + ')})`)
