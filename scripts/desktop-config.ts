/** デスクトップの固定入力をコアの設定Schemaで検証してから新規保存する。 */
import { randomBytes } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, linkSync, openSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { configPath, resolveConfig } from '../src/katazuku-config.js'
import { repositoryRoot } from '../src/database-path.js'
import { isGoogleAccountEmail, isPersonalProfile } from '../src/setup-values.js'

export interface ConfigResult { ok: boolean; output: string }

export function saveDesktopConfig(root: string, input: unknown, env: NodeJS.ProcessEnv = process.env): ConfigResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, output: '設定の入力を確認してください。' }
  const form = input as Record<string, unknown>
  const displayName = typeof form.displayName === 'string' ? form.displayName.trim() : ''
  const email = typeof form.email === 'string' ? form.email.trim() : ''
  const signature = typeof form.signature === 'string' ? form.signature.split(/\r?\n/).map(line => line.trim()).filter(Boolean) : []
  if (!displayName || displayName.length > 40) return { ok: false, output: '呼び名は1〜40文字で入力してください。' }
  if (email.length > 254 || !isGoogleAccountEmail(email)) return { ok: false, output: '雛形ではなく、自分のGoogleアカウントのメールアドレスを入力してください。' }
  if (!signature.length || signature.length > 8 || signature.some(line => line.length > 120)) return { ok: false, output: '署名は1〜8行、各行120文字以内で入力してください。' }
  if (!isPersonalProfile(displayName, signature)) return { ok: false, output: '雛形の呼び名・署名を自分の値に置き換えてください。' }
  const providers = form.providerOrder
  if (!Array.isArray(providers) || !providers.length || providers.some(provider => !['claude-cli', 'codex-cli', 'chatgpt-siwc'].includes(provider))) {
    return { ok: false, output: '使うAIを少なくとも1つ選んでください。' }
  }
  const config = {
    $schema: './schemas/katazuku-config.schema.json',
    profile: { displayName, timezone: 'Asia/Tokyo', signature },
    google: {
      accounts: [{ id: 'main', email, primary: true, calendars: 'all-visible' }],
      ...(env.KATAZUKU_GOOGLE_CREDENTIALS_DIR ? { credentialsDir: resolve(env.KATAZUKU_GOOGLE_CREDENTIALS_DIR) } : {}),
    },
    agent: { providerOrder: [...new Set(providers)] },
    notify: { selfEmail: false, desktop: true },
  }
  let temporary: string | undefined
  let descriptor: number | undefined
  try {
    resolveConfig(config, undefined, root)
    const path = configPath(root, env)
    temporary = join(dirname(path), '.katazuku-config-' + randomBytes(16).toString('hex') + '.tmp')
    descriptor = openSync(temporary, 'wx', 0o600)
    writeFileSync(descriptor, JSON.stringify(config, null, 2) + '\n')
    fsyncSync(descriptor)
    closeSync(descriptor); descriptor = undefined
    linkSync(temporary, path) // 既存の設定は、上書き指定があっても置換しない。
    return { ok: true, output: '設定を保存しました。認証・同期・定期実行はまだ開始していません。次に接続手順と診断を確認してください。' }
  } catch (error) {
    return { ok: false, output: (error as NodeJS.ErrnoException).code === 'EEXIST'
      ? '設定ファイルが既にあります。既存の設定は上書きせず、手順に沿って確認してください。'
      : '設定を保存できませんでした。入力形式・保存先・アクセス権を確認してください。値は表示しません。' }
  } finally {
    try { if (descriptor !== undefined) closeSync(descriptor) } catch { /* 保存結果をcleanup失敗で変えない。 */ }
    try { if (temporary && existsSync(temporary)) unlinkSync(temporary) } catch { /* 一時ファイルはgitignore済み。 */ }
  }
}

export async function readDesktopInput(stream: Readable): Promise<unknown> {
  stream.setEncoding('utf8') // パイプのchunk境界が日本語の途中でも文字を壊さない。
  let input = ''
  for await (const chunk of stream) {
    input += chunk
    if (Buffer.byteLength(input) > 16_384) throw new Error('too large')
  }
  return JSON.parse(input)
}

async function main(): Promise<void> {
  try {
    const root = repositoryRoot()
    if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'))
    const result = saveDesktopConfig(root, await readDesktopInput(process.stdin))
    console.log(result.output)
    process.exitCode = result.ok ? 0 : 1
  } catch {
    console.error('設定を保存できませんでした。入力と個人設定の形式を確認してください。値は表示しません。')
    process.exitCode = 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
