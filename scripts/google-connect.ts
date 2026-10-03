/** 本人が起動する接続CLI。エラーの設定値・URL・個人値は表示しない。 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { repositoryRoot } from '../src/database-path.js'
import { checkStoredGoogleReadConnection, connectGoogleReadOnly, GoogleConnectError, GOOGLE_READ_SUCCESS } from '../src/google-connect.js'
import { loadConfig } from '../src/katazuku-config.js'

const args = process.argv.slice(2)
if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
  console.log('Google読取り専用接続\n  npm run google:connect\n  npm run google:connect -- --account 設定のアカウントID\n  npm run google:connect -- --check\n本人がブラウザで許可します。既存資格情報は上書きしません。--checkは保存済みトークンの更新と読取り通信だけを行います。\nメール下書き・予定書込みは別のMCP接続が必要です。詳しくは docs/GOOGLE-CONNECTION.md を参照してください。')
} else {
  const controller = new AbortController()
  const cancel = () => controller.abort()
  process.once('SIGINT', cancel)
  process.once('SIGTERM', cancel)
  try {
    let accountId: string | undefined
    let check = false
    for (let index = 0; index < args.length; index++) {
      if (args[index] === '--check' && !check) check = true
      else if (args[index] === '--account' && accountId === undefined && args[index + 1] && !args[index + 1].startsWith('--')) accountId = args[++index]
      else throw new GoogleConnectError('引数が不正です。npm run google:connect -- --help を確認してください。')
    }
    const root = repositoryRoot()
    if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'))
    const config = loadConfig(root)
    const account = accountId === undefined ? config.google.accounts.find(account => account.primary) : config.google.accounts.find(account => account.id === accountId)
    if (!config.source || !account) throw new GoogleConnectError('個人設定に自分のGoogleアカウントと主アカウントを指定してください。--accountは設定済みIDだけ使えます。')
    if (check) {
      console.log('保存済み資格情報で本人確認とGmail・Calendarの読み取り通信を確認します。内容・件数・個人値は表示しません。')
      await checkStoredGoogleReadConnection(account.email, config.google.credentialsDir, fetch, process.env, AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)]))
    } else {
      console.log('本人がGoogleのブラウザ画面で許可してください。Gmail・Calendarの読取りとアカウント確認だけを要求します。5分で中止します。\n既存資格情報は上書きしません。メール下書き・予定書込みは別のMCP接続が必要です。')
      await connectGoogleReadOnly({ email: account.email, credentialsDir: config.google.credentialsDir, root,
        clientId: process.env.GOOGLE_OAUTH_CLIENT_ID ?? '', clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '', signal: controller.signal })
      console.log('読取り専用の資格情報を本人だけがアクセスできるファイルに保存しました。')
    }
    console.log(GOOGLE_READ_SUCCESS)
  } catch (error) {
    console.error(error instanceof GoogleConnectError ? error.message : '接続できませんでした。個人設定と.envの形式・読み取り権限を確認してください。値は表示しません。')
    process.exitCode = 1
  } finally {
    process.removeListener('SIGINT', cancel)
    process.removeListener('SIGTERM', cancel)
  }
}
