/**
 * ChatGPT プラン利用(Sign in with ChatGPT)のサインイン管理。
 *
 *   npm run chatgpt -- signin [--label default] [--enable-plan]   # ブラウザで「Continue with ChatGPT」
 *   npm run chatgpt -- status                                      # 保存済みアカウントと、プラン利用の可否
 *   npm run chatgpt -- models                                      # このアカウントで使えるモデル
 *   npm run chatgpt -- use <label> [--model <slug>]                # 使うアカウント・モデルを選ぶ
 *   npm run chatgpt -- signout [--label <label>]                   # セッションを失効させ、トークンを消す
 *
 * 資格情報はリポジトリの外(既定 ~/.config/katazuku/chatgpt/ 、Windows は %APPDATA%\katazuku\chatgpt)に置く。
 * 使う順番は katazuku.config.json の agent.providerOrder。docs/AI-PROVIDERS.md 参照。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  activeLabel,
  buildAuthorizationAttempt,
  buildCredentialRecord,
  credentialsDir,
  discover,
  ensureFreshCredential,
  exchangeCode,
  getOrCreateHostId,
  isSiwcEnabled,
  listCredentials,
  listModels,
  loadCredential,
  redactAuthorizationUrl,
  saveCredential,
  setActiveLabel,
  signOut,
  startLoopback,
  validateCallback,
  verifyIdToken,
} from '../src/providers/chatgpt-siwc.js'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'))

/** ChatGPT の「設定 → 使用量(Usage)」への案内。TODO: 公式ドキュメントに直リンクのURLが載ったら差し替える */
const MANAGE_USAGE = 'ChatGPT の 設定 → 使用量(Usage) で、このアプリの使用量と上限を確認・変更できます'

function openBrowser(url: string): boolean {
  try {
    const [command, args] = process.platform === 'win32'
      // cmd の start は & を区切りと解釈してURLを壊すので使わない
      ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
    const child = spawn(command as string, args as string[], { stdio: 'ignore', detached: true })
    child.on('error', () => {})
    child.unref()
    return true
  } catch {
    return false
  }
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

async function signIn(args: string[]): Promise<void> {
  const dir = credentialsDir()
  const label = option(args, '--label') ?? activeLabel(dir) ?? 'default'
  const existing = loadCredential(dir, label)
  const hostId = getOrCreateHostId(dir)
  const discovery = await discover()
  const loopback = await startLoopback()
  try {
    const attempt = buildAuthorizationAttempt({
      discovery,
      hostId,
      port: loopback.port,
      existing: existing?.client_id ? existing : undefined,
      requestConsent: args.includes('--enable-plan'),
    })
    console.log('Continue with ChatGPT: ブラウザでサインインと許可を行ってください。')
    console.log('このアプリは、あなたの ChatGPT プランを katazuku の推論に使う許可を求めます(会話履歴などへのアクセスは含みません)。')
    const opened = openBrowser(attempt.url)
    if (!opened || !existing?.id_token) {
      // id_token_hint を含むURLはログや画面に出さない
      console.log(`ブラウザが開かない場合は次のURLを開いてください:\n${existing?.id_token ? redactAuthorizationUrl(attempt.url) : attempt.url}`)
    }
    const query = await loopback.wait(5 * 60_000)
    const callback = validateCallback(query, attempt)
    const token = await exchangeCode(discovery, attempt, callback)
    if (!token.id_token) throw new Error('IDトークンが返りませんでした')
    const claims = await verifyIdToken(token.id_token, { discovery, clientId: callback.clientId, nonce: attempt.nonce })
    const record = buildCredentialRecord({ label, token, claims, clientId: callback.clientId, hostId, callbackScope: callback.scope, existing })
    if (!record.welcomed && record.plan_usage_enabled) {
      console.log('\nChatGPT プランを使っています')
      console.log('katazuku の対象となるAI処理は、あなたの ChatGPT プランの使用量で動きます。' + MANAGE_USAGE)
      record.welcomed = true
    }
    try {
      if (record.plan_usage_enabled && record.access_token && !record.model) record.model = (await listModels(record.access_token))[0]?.slug
    } catch {
      // モデル一覧は推論時にも取り直せる
    }
    saveCredential(dir, record)
    setActiveLabel(dir, label)
    console.log(`\nサインインしました: ${record.email || record.subject}(ラベル: ${label})`)
    if (!record.plan_usage_enabled) {
      console.log('ChatGPT プランの利用は許可されていません。推論には使いません。')
      console.log('許可する場合: npm run chatgpt -- signin --enable-plan / 代わりに API キーを使う場合: docs/AI-PROVIDERS.md の openai-api')
    } else {
      console.log(`使用中: ChatGPT プラン / モデル: ${record.model ?? '(推論時に自動選択)'}`)
    }
    console.log('\n推論に使う順番は katazuku.config.json の agent.providerOrder で決まります(chatgpt-siwc を入れてください)。')
    if (!isSiwcEnabled(process.env)) console.log('注意: KATAZUKU_DISABLE_CHATGPT_SIWC=1 が設定されているため、今は使われません。')
  } finally {
    loopback.close()
  }
}

async function main(): Promise<void> {
  const [command = 'status', ...args] = process.argv.slice(2)
  const dir = credentialsDir()
  if (command === 'signin') return signIn(args)
  if (command === 'status') {
    const active = activeLabel(dir)
    const records = listCredentials(dir)
    if (!records.length) {
      console.log('保存済みの ChatGPT アカウントはありません(npm run chatgpt -- signin)')
      return
    }
    for (const record of records) {
      const state = !record.refresh_token ? 'サインアウト済み' : record.plan_usage_enabled ? 'ChatGPT プラン使用中' : 'プラン利用は未許可'
      console.log(`${record.label === active ? '*' : ' '} ${record.label}: ${record.email || record.subject} / ${state} / モデル: ${record.model ?? '自動'}`)
    }
    console.log(`\n${MANAGE_USAGE}`)
    console.log(`ChatGPT プランでの推論: ${isSiwcEnabled(process.env) ? '有効' : '無効(KATAZUKU_DISABLE_CHATGPT_SIWC=1)'}`)
    return
  }
  if (command === 'models') {
    const label = option(args, '--label') ?? activeLabel(dir)
    if (!label) throw new Error('サインインしていません')
    const record = await ensureFreshCredential(dir, label)
    for (const model of await listModels(record.access_token ?? '')) console.log(`${model.slug}\t${model.display_name}`)
    return
  }
  if (command === 'use') {
    const label = args[0]
    const record = label ? loadCredential(dir, label) : undefined
    if (!record) throw new Error(`保存済みのアカウントがありません: ${label ?? ''}`)
    const model = option(args, '--model')
    if (model) saveCredential(dir, { ...record, model })
    setActiveLabel(dir, record.label)
    console.log(`使用するアカウント: ${record.label}${model ? ` / モデル: ${model}` : ''}`)
    return
  }
  if (command === 'signout') {
    const label = option(args, '--label') ?? activeLabel(dir)
    if (!label) throw new Error('サインインしていません')
    const { revoked } = await signOut(dir, label)
    console.log(revoked
      ? 'サインアウトしました(セッションを失効させ、このPCのトークンを消しました)'
      : 'このPCのトークンを消しましたが、サーバ側の失効は確認できませんでした。ChatGPT の設定からこのアプリの接続を解除できます')
    return
  }
  console.error('使い方: npm run chatgpt -- signin | status | models | use <label> [--model <slug>] | signout')
  process.exitCode = 1
}

main().catch((error) => {
  console.error((error as Error).message)
  process.exitCode = 1
})
