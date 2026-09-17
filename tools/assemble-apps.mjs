import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { assertPublicAssets, APP_NAMES } from './assert-private-assets.mjs'
import { build } from 'esbuild'
const root = resolve(import.meta.dirname, '..')
const destination = join(root, 'web-dist')
mkdirSync(destination, { recursive: true })
cpSync(join(root, 'web'), destination, { recursive: true })
await build({ entryPoints: [join(root, 'src/password-proof.ts')], outfile: join(destination, 'auth-proof.js'), format: 'esm' })
for (const app of APP_NAMES) {
  const source = join(root, app, 'dist')
  if (!existsSync(join(source, 'index.html'))) throw new Error(app + ' の画面を先にビルドしてください。')
  assertPublicAssets(source)
  cpSync(source, join(destination, app), { recursive: true })
}
cpSync(join(root, 'board', 'public', 'icons'), join(destination, 'icons'), { recursive: true })
assertPublicAssets(destination)
console.log('公開する画面を組み立てました。個人データは含みません。')
