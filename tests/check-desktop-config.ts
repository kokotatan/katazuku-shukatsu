/** 合成入力と一時保存先だけで、ウィザードが不正設定を成功扱いしないことを確認する。 */
import { strict as assert } from 'node:assert'
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { readDesktopInput, saveDesktopConfig } from '../scripts/desktop-config.js'
import { loadConfig } from '../src/katazuku-config.js'
import { inspectSetup } from '../scripts/setup-doctor.js'

const root = mkdtempSync(join(tmpdir(), 'katazuku-desktop-'))
const repo = fileURLToPath(new URL('..', import.meta.url))
const target = join(root, 'katazuku.config.json')
const form = { displayName: '利用者A（架空）', email: 'you@example.test', signature: '利用者A（架空）', providerOrder: ['codex-cli'] }
let count = 0
const check = (label: string, condition: boolean) => { assert(condition, label); console.log('[ok] ' + label); count++ }
const save = (input: unknown) => saveDesktopConfig(root, input, {})
const noTemporary = () => !readdirSync(root).some(name => name.startsWith('.katazuku-config-'))
function cli(path: string, input: string): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(repo, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(repo, 'scripts', 'desktop-config.ts')], {
      cwd: root, env: { ...process.env, KATAZUKU_CONFIG: path }, windowsHide: true,
    })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { output += chunk })
    child.on('error', reject)
    child.on('close', code => resolve({ code, output }))
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}
try {
  mkdirSync(join(root, 'schemas'))
  const schemaPath = join(root, 'schemas', 'katazuku-config.schema.json')
  const originalSchema = readFileSync(join(repo, 'schemas', 'katazuku-config.schema.json'), 'utf8')
  copyFileSync(join(repo, 'schemas', 'katazuku-config.schema.json'), schemaPath)
  for (const [label, input] of [
    ['入力なし', undefined], ['配列', []], ['呼び名なし', { ...form, displayName: '  ' }],
    ['長すぎる呼び名', { ...form, displayName: 'a'.repeat(41) }], ['不正なメール', { ...form, email: 'invalid' }],
    ['パスを含むメール', { ...form, email: '../you@example.test' }], ['署名なし', { ...form, signature: ' \n ' }],
    ['長すぎる署名', { ...form, signature: 'a'.repeat(121) }], ['署名9行', { ...form, signature: Array(9).fill('架空').join('\n') }],
    ['AI未選択', { ...form, providerOrder: [] }], ['AI不明', { ...form, providerOrder: ['unknown'] }],
    ['AI型不正', { ...form, providerOrder: 'codex-cli' }],
    ['雛形の呼び名', { ...form, displayName: '就活 太郎' }], ['雛形の署名', { ...form, signature: 'サンプル大学' }],
    ['雛形のアカウント', { ...form, email: 'you@example.com' }],
  ] as [string, unknown][]) {
    check(label + 'は保存せず修正を案内する', !save(input).ok && !existsSync(target) && noTemporary())
  }
  const schema = JSON.parse(originalSchema)
  schema.properties.agent.properties.providerOrder.minItems = 2
  writeFileSync(schemaPath, JSON.stringify(schema))
  check('コアのSchema制約を保存前に適用する', !save(form).ok && !existsSync(target))
  writeFileSync(schemaPath, originalSchema)
  const stream = new PassThrough()
  const reading = readDesktopInput(stream)
  const japanese = Buffer.from(JSON.stringify(form))
  const boundary = japanese.indexOf(Buffer.from('利用者')) + 1
  stream.write(japanese.subarray(0, boundary))
  await new Promise(resolve => setImmediate(resolve))
  stream.end(japanese.subarray(boundary))
  check('標準入力が日本語の途中で分割されても値を保持する', JSON.stringify(await reading) === JSON.stringify(form))
  const exactInput = JSON.stringify(form) + ' '.repeat(16_384 - Buffer.byteLength(JSON.stringify(form)))
  const exactStream = new PassThrough()
  exactStream.end(exactInput)
  check('入力上限の16384byteは受け付ける', JSON.stringify(await readDesktopInput(exactStream)) === JSON.stringify(form))
  const excessiveStream = new PassThrough()
  excessiveStream.end(exactInput + ' ')
  await assert.rejects(readDesktopInput(excessiveStream))
  check('入力上限を1byte超えると拒否する', true)
  const emptyStream = new PassThrough()
  emptyStream.end()
  await assert.rejects(readDesktopInput(emptyStream))
  check('空の標準入力を拒否する', true)
  const result = save({ ...form, displayName: '  ' + form.displayName + '  ', signature: ' 架空署名 \r\n\r\n 二行目 ', providerOrder: ['codex-cli', 'codex-cli'] })
  const loaded = loadConfig(root, {})
  check('有効な設定をコアで読み込める', result.ok && loaded.profile.displayName === form.displayName && loaded.google.accounts[0]?.email === form.email)
  check('署名とAI重複を整え、通知メールを既定で無効にする', loaded.profile.signature.join('|') === '架空署名|二行目' && loaded.agent.providerOrder.join() === 'codex' && !loaded.notify.selfEmail)
  check('設定保存を実接続の完了と表示しない', result.output.includes('まだ開始していません'))
  const previous = readFileSync(target, 'utf8')
  check('既存設定は上書き要求があっても保持する', !save({ ...form, overwrite: true }).ok && readFileSync(target, 'utf8') === previous && noTemporary())
  if (process.platform !== 'win32') check('新規設定のモードは本人だけが読み書きできる', (statSync(target).mode & 0o777) === 0o600)
  const selected = join(root, 'selected.json')
  check('KATAZUKU_CONFIGに選んだ保存先をコアと共有する', saveDesktopConfig(root, form, { KATAZUKU_CONFIG: selected }).ok && loadConfig(root, { KATAZUKU_CONFIG: selected }).source === selected)
  const isolated = join(root, 'isolated.json')
  const isolatedCredentials = join(root, 'isolated-google')
  check('配布版のGoogle認証先をアプリ保存領域へ分離する', saveDesktopConfig(root, form, {
    KATAZUKU_CONFIG: isolated, KATAZUKU_GOOGLE_CREDENTIALS_DIR: isolatedCredentials,
  }).ok && loadConfig(root, { KATAZUKU_CONFIG: isolated }).google.credentialsDir === isolatedCredentials)
  const ordered = join(root, 'ordered.json')
  check('選択したAIの順序とChatGPTを保持する', saveDesktopConfig(root, { ...form, providerOrder: ['chatgpt-siwc', 'claude-cli'] }, { KATAZUKU_CONFIG: ordered }).ok && loadConfig(root, { KATAZUKU_CONFIG: ordered }).agent.providerOrder.join() === 'chatgpt-siwc,claude')
  const missingParent = join(root, 'missing-parent', 'do-not-print-this.json')
  const failure = saveDesktopConfig(root, { ...form, displayName: 'do-not-print-this' }, { KATAZUKU_CONFIG: missingParent })
  check('保存失敗で入力値や保存先を表示しない', !failure.ok && !failure.output.includes('do-not-print-this') && !existsSync(missingParent) && noTemporary())
  // 子プロセスはこのcheckoutの.envを読むため、個人.envがある実作業環境では起動しない。
  if (!existsSync(join(repo, '.env'))) {
    const cliTarget = join(root, 'cli.json')
    const bad = await cli(cliTarget, '{do-not-print-this')
    check('不正JSONのCLI出力に入力値を出さない', bad.code === 1 && !bad.output.includes('do-not-print-this') && !existsSync(cliTarget))
    const oversized = await cli(cliTarget, JSON.stringify({ ...form, signature: 'private-fixture'.repeat(2000) }))
    check('CLIの入力上限で保存を拒否する', oversized.code === 1 && !oversized.output.includes('private-fixture') && !existsSync(cliTarget))
    const competing = await Promise.all([cli(cliTarget, JSON.stringify(form)), cli(cliTarget, JSON.stringify({ ...form, displayName: '利用者B（架空）' }))])
    const persisted = JSON.parse(readFileSync(cliTarget, 'utf8'))
    check('同時保存でも一方だけ成功し、完全な設定を保持する', competing.filter(item => item.code === 0).length === 1 && competing.filter(item => item.code === 1).length === 1 && [form.displayName, '利用者B（架空）'].includes(persisted.profile.displayName) && noTemporary())
    check('CLI保存した設定をコアで読める', loadConfig(root, { KATAZUKU_CONFIG: cliTarget }).agent.providerOrder[0] === 'codex')
  } else console.log('[skip] 個人.envのあるcheckoutでは子プロセスを起動しない')
  // 資格情報の保存先とAIコマンドを合成経路へ向け、本人ファイルを読ませない。
  const forDiagnostic = JSON.parse(previous)
  forDiagnostic.google.credentialsDir = join(root, 'fake-credentials')
  writeFileSync(selected, JSON.stringify(forDiagnostic))
  const diagnostic = await inspectSetup(root, { env: { PATH: '', KATAZUKU_CONFIG: selected, KATAZUKU_CHATGPT_DIR: join(root, 'fake-chatgpt') }, commands: { claude: join(root, 'missing-claude'), codex: join(root, 'missing-codex'), 'codex-oss': join(root, 'missing-oss') } })
  check('保存画面と診断で個人設定・アカウントの判定が一致する', ['個人設定', 'Google対象アカウント'].every(name => diagnostic.some(item => item.name === name && item.status === 'pass')))
  check('有効な保存後でも接続不足は診断する', diagnostic.some(item => item.name === 'Google資格情報' && item.status === 'missing'))
  console.log(`${count} desktop config checks passed`)
} finally {
  rmSync(root, { recursive: true, force: true })
}
