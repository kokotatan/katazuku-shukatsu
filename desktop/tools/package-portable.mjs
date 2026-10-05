/** Windows配布フォルダーを公開ソースと固定の生成物だけから作る。個人設定は列挙もしない。 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { VIEWER_APPS } from '../../tools/viewer-server.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const output = resolve(process.argv[2] || join(root, 'dist', 'katazuku-windows-x64'))
const reuseInstalled = process.argv.includes('--reuse-installed')
if (process.argv.slice(3).some(value => value !== '--reuse-installed')) throw new Error('不明なオプションです')
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Windows x64上でビルドしてください')
if (existsSync(output)) throw new Error('出力先が既にあります。既存の配布物を保持するため、別の出力先を指定してください')
const npm = 'npm.cmd'
function run(command, args, cwd = root, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', shell: command === npm, windowsHide: true })
  if (result.error || result.status !== 0) throw new Error(`${command} ${args.join(' ')} が失敗しました`)
}
function copy(source, target) {
  if (!lstatSync(source).isFile()) throw new Error('配布対象は通常ファイルだけです: ' + source)
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(source, target)
}
function files(path, prefix = '') {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    const relative = prefix + entry.name
    if (entry.isSymbolicLink()) throw new Error('配布対象のリンクは許可しません: ' + relative)
    return entry.isDirectory() ? files(join(path, entry.name), relative + '/') : [relative]
  })
}
// git管理下でも配布する種類を限定する。データ・ログ・.env・個人設定は対象にならない。
const tracked = spawnSync('git', ['ls-files', '-z', '--', 'src', 'scripts', 'schemas', 'docs', 'desktop', 'tools', 'LICENSE', 'NOTICE', 'SECURITY.md'], { cwd: root, encoding: 'utf8', windowsHide: true })
if (tracked.status !== 0) throw new Error('公開ソース一覧を取得できません')
const allow = /^(?:(?:src|scripts)\/[a-zA-Z0-9_/-]+\.(?:ts|mjs|md|ps1)|schemas\/[a-zA-Z0-9_.-]+\.json|docs\/[a-zA-Z0-9_/-]+\.md|desktop\/(?:main\.mjs|preload\.cjs|renderer\/[a-zA-Z0-9_.-]+)|tools\/viewer-(?:server\.mjs|home\.html|home\.js)|LICENSE|NOTICE|SECURITY\.md)$/
const publicFiles = tracked.stdout.split('\0').filter(name => allow.test(name))
for (const required of ['schemas/katazuku-config.schema.json', 'src/db.ts', 'src/katazuku-config.ts', 'scripts/desktop-config.ts', 'desktop/preload.cjs', 'tools/viewer-home.html']) {
  if (!publicFiles.includes(required)) throw new Error('必要な公開ファイルが許可リストにありません: ' + required)
}
const notices = new Map()
function collectNotices(directory) {
  const packages = spawnSync(npm, ['ls', '--omit=dev', '--all', '--parseable'], { cwd: directory, encoding: 'utf8', shell: true, windowsHide: true })
  if (packages.status !== 0) throw new Error('配布依存の一覧を取得できません: ' + packages.stderr)
  for (const path of packages.stdout.trim().split(/\r?\n/).slice(1)) {
    const metadata = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'))
    const id = `${metadata.name}@${metadata.version}`
    const licenses = readdirSync(path).filter(name => /^(?:licen[sc]e|copying|notice)(?:[.-].*)?$/i.test(name) && lstatSync(join(path, name)).isFile())
    notices.set(id, `${id}\nDeclared license: ${JSON.stringify(metadata.license ?? 'see package documentation')}\n${licenses.map(name => readFileSync(join(path, name), 'utf8')).join('\n')}\n`)
  }
}
if (!reuseInstalled) {
  run(npm, ['ci', '--include=dev', '--no-audit', '--no-fund'])
  run(npm, ['ci', '--include=dev', '--no-audit', '--no-fund'], join(root, 'desktop'))
}
// Electron 44はnpmパッケージと実バイナリの取得が別。公式installerでchecksumも検証する。
run(process.execPath, [join(root, 'desktop', 'node_modules', 'electron', 'install.js')])
for (const name of VIEWER_APPS) {
  // Viteは同一プロセスのNODE_ENVをproductionにする。後続画面にもビルド用依存を必ず入れる。
  if (!reuseInstalled) run(npm, ['ci', '--include=dev', '--no-audit', '--no-fund'], join(root, name))
  run(process.execPath, [join(root, name, 'node_modules', 'typescript', 'bin', 'tsc'), '-b'], join(root, name))
  const { build } = await import(pathToFileURL(join(root, name, 'node_modules', 'vite', 'dist', 'node', 'index.js')).href)
  // publicには実データsnapshot.jsonがあり得るため、Viteにも読ませない。
  await build({ root: join(root, name), publicDir: false, envDir: false })
  collectNotices(join(root, name))
}
const runtimeInstall = mkdtempSync(join(tmpdir(), 'katazuku-runtime-build-'))
for (const name of ['package.json', 'package-lock.json']) copy(join(root, 'desktop', name), join(runtimeInstall, name))
run(npm, ['ci', '--omit=dev', '--no-audit', '--no-fund'], runtimeInstall)
collectNotices(runtimeInstall)
// --demoだけを固定指定。既存snapshotやログをコピーせずメモリ内の合成データを生成する。
const generated = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', "import {buildDemoSnapshot} from './scripts/snapshot.ts'; console.log(JSON.stringify(buildDemoSnapshot()))"], { cwd: root, encoding: 'utf8', windowsHide: true })
if (generated.status !== 0) throw new Error('架空データの生成に失敗しました: ' + generated.stderr)
const snapshot = JSON.parse(generated.stdout)
if (snapshot.demo !== true) throw new Error('架空データのモードを確認できません')
const electron = join(root, 'desktop', 'node_modules', 'electron', 'dist')
if (!existsSync(join(electron, 'electron.exe'))) throw new Error('公式ElectronのWindows実行ファイルがありません')
mkdirSync(output, { recursive: true })
cpSync(electron, output, { recursive: true, filter: path => !path.endsWith('default_app.asar') })
renameSync(join(output, 'electron.exe'), join(output, 'katazuku.exe'))
const app = join(output, 'resources', 'app')
const runtime = join(app, 'runtime')
for (const name of publicFiles) copy(join(root, name), join(name.startsWith('desktop/') ? app : runtime, name))
copy(join(root, 'tools', 'viewer-server.mjs'), join(app, 'tools', 'viewer-server.mjs'))
const desktopPackage = JSON.parse(readFileSync(join(root, 'desktop', 'package.json'), 'utf8'))
writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'katazuku-desktop', productName: 'katazuku', version: desktopPackage.version, type: 'module', main: 'desktop/main.mjs' }, null, 2))
writeFileSync(join(runtime, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
cpSync(join(runtimeInstall, 'node_modules'), join(runtime, 'node_modules'), { recursive: true })
for (const name of VIEWER_APPS) {
  const dist = join(root, name, 'dist')
  for (const file of files(dist).filter(file => file === 'index.html' || /^assets\/[a-zA-Z0-9_./-]+\.(?:js|css|svg|png|ico|woff2?|ttf)$/.test(file))) copy(join(dist, file), join(runtime, name, 'dist', file))
  mkdirSync(join(runtime, name, 'public'), { recursive: true })
  writeFileSync(join(runtime, name, 'public', 'snapshot.demo.json'), JSON.stringify(snapshot))
}
writeFileSync(join(output, '使い方.txt'), 'katazuku Windows x64 試用版\r\n\r\nフォルダーをすべて展開して katazuku.exe を開いてください。Node.js・npm・ターミナルは不要です。\r\n「まず架空データで体験する」で8画面を閲覧できます。設定やGoogle接続は不要です。\r\n設定はWindowsのアプリデータ領域へ保存し、配布フォルダーへ書き込みません。\r\nGoogle本人認証・実同期・定期実行登録は別途必要です。コード署名とGoogle本人認証は未検証です。\r\nフォルダー内のElectron/Chromiumと各依存のLICENSEも含めて配布してください。\r\n')
writeFileSync(join(output, 'THIRD-PARTY-NOTICES.txt'), [...notices.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, text]) => text).join('\n---\n\n'))
const manifest = files(output).sort().map(name => ({ path: name, sha256: createHash('sha256').update(readFileSync(join(output, name))).digest('hex') }))
if (manifest.some(({ path }) => /(?:^|\/)(?:\.env(?:\..*)?|katazuku\.config\.json|snapshot\.json|credential-store|logs|data)(?:\/|$)/.test(path))) throw new Error('配布対象外のパスがあります')
writeFileSync(join(output, 'manifest.json'), JSON.stringify({ format: 1, platform: 'win32-x64', electron: readFileSync(join(electron, 'version'), 'utf8').trim(), files: manifest }, null, 2))
console.log('配布フォルダーを作成しました: ' + output)
