import { cp, mkdir, readFile, writeFile, access, rm } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import { assertPublicAssets } from './assert-private-assets.mjs'

// ソースとビルド済み画面の許可リストだけを梱包する。データ・資格情報・.envを探索／複写しない。
const root = resolve(import.meta.dirname, '..')
const output = resolve(process.argv[2] || join(root, 'desktop-dist', 'katazuku-windows'))
if (process.platform !== 'win32') throw new Error('Windows向けの配布物はWindowsで作成してください。')
try { await access(output); throw new Error('出力先が存在します。新しい出力先を指定してください。') } catch (e) { if (e.code !== 'ENOENT') throw e }
assertPublicAssets(join(root, 'web-dist'))
await access(join(root, 'dist/db.js'))
await mkdir(output, { recursive: true })
for (const name of ['dist', 'web-dist', 'node_modules']) await cp(join(root, name), join(output, name), { recursive: true })
await mkdir(join(output, 'tools'), { recursive: true })
await cp(join(root, 'tools/setup'), join(output, 'tools/setup'), { recursive: true, filter: source => !/[/\\]check[^/\\]*$/.test(source) })
await cp(join(root, 'tools/google-workspace'), join(output, 'tools/google-workspace'), { recursive: true, filter: source => !/[/\\](?:check[^/\\]*|__pycache__)$/.test(source) })
await mkdir(join(output, 'scripts'), { recursive: true })
await cp(join(root, 'scripts/open-setup.ps1'), join(output, 'scripts/open-setup.ps1'))
for (const file of ['katazukuの設定.vbs', 'package.json', 'LICENSE', 'NOTICE', 'SECURITY.md']) await cp(join(root, file), join(output, file))
await mkdir(join(output, 'cloudflare'), { recursive: true })
await build({ entryPoints: [join(root, 'cloudflare/worker.ts')], outfile: join(output, 'cloudflare/worker.ts'), bundle: true, platform: 'neutral', external: ['node:*'], format: 'esm' })

const version = '24.16.0'
const filename = `node-v${version}-win-x64.zip`
const expected = 'edaca9bd58ec8e92037dac4e877d52f6b8f430b81c18b57e264b4e2fb111cd56'
const response = await fetch('https://nodejs.org/dist/v' + version + '/' + filename, { redirect: 'error', signal: AbortSignal.timeout(120_000) })
if (!response.ok) throw new Error('公式Node.jsを取得できませんでした。')
const bytes = Buffer.from(await response.arrayBuffer())
if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('Node.jsのSHA-256が公式配布値と一致しません。')
const runtimeArchive = output + '.node.zip'
await writeFile(runtimeArchive, bytes)
// 固定のPowerShellコードへ、パスは引数として渡す。文字列をコマンドとして組み立てない。
const unpack = join(output, 'unpack-runtime.ps1')
await writeFile(unpack, 'param([string]$Archive,[string]$Destination)\nExpand-Archive -LiteralPath $Archive -DestinationPath $Destination\n')
await promisify(execFile)('powershell.exe', ['-NoProfile', '-File', unpack, runtimeArchive, join(output, 'vendor')], { windowsHide: true })
await mkdir(join(output, 'runtime'), { recursive: true })
await cp(join(output, 'vendor', 'node-v' + version + '-win-x64', 'node.exe'), join(output, 'runtime/node.exe'))
await cp(join(output, 'vendor', 'node-v' + version + '-win-x64', 'LICENSE'), join(output, 'runtime/LICENSE'))
// 展開時だけ使ったものを梱包しない。削除対象はこの実行の出力先の直下に限定する。
const vendor = resolve(output, 'vendor')
if (dirname(vendor) !== output || vendor !== join(output, 'vendor')) throw new Error('展開先の場所を確認できません。')
await rm(vendor, { recursive: true, force: true })
await rm(unpack); await rm(runtimeArchive)
await writeFile(join(output, 'はじめに.txt'), 'katazuku 就活（導入確認用）\r\n\r\n「katazukuの設定.vbs」をダブルクリックしてください。\r\nNode.jsやnpmのインストール、ターミナルへのコマンド入力は不要です。\r\n\r\n自分のCloudflareアカウントに非公開の保存先を用意し、パスワードとGoogleを設定します。Cloudflareの利用設定と料金はCloudflareの画面で確認してください。\r\nGoogleのデータアクセス審査は未完了です。警告が出ない完成版としてはまだ配布できません。\r\n個人の記録・資格情報はこの配布物に入っていません。\r\n')
await writeFile(join(output, 'build-info.json'), JSON.stringify({ node: version, nodeArchiveSha256: expected, builtAt: new Date().toISOString(), status: 'verification-pending' }, null, 2))
console.log('PC設定の配布フォルダを作成しました: ' + output)
