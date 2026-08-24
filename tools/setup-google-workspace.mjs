#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  createGoogleWorkspaceConfig,
  parseDesktopOAuthCredentials,
  resolveGoogleWorkspaceConfigPath,
  writeGoogleWorkspaceConfig,
} from '../src/google-workspace-config.js'

function usage() {
  console.log(`使い方:
  npm run setup:google -- --credentials <client_secret.json> --email <自分のGoogleアカウント>

オプション:
  --force  既存のローカル設定を置き換える
  --help   この説明を表示する`)
}

function parseArgs(argv) {
  const result = { credentials: '', email: '', force: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') return { ...result, help: true }
    if (arg === '--force') { result.force = true; continue }
    if (arg === '--credentials') { result.credentials = argv[++i] || ''; continue }
    if (arg === '--email') { result.email = argv[++i] || ''; continue }
    throw new Error(`未知のオプションです: ${arg}`)
  }
  return result
}

try {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) { usage(); process.exit(0) }
  if (!options.credentials || !options.email) {
    usage()
    throw new Error('--credentials と --email は必須です')
  }

  const credentialPath = resolve(options.credentials)
  const credentialJson = JSON.parse(await readFile(credentialPath, 'utf8'))
  const oauth = parseDesktopOAuthCredentials(credentialJson)
  const config = createGoogleWorkspaceConfig({ ...oauth, accountEmail: options.email })
  const configPath = await writeGoogleWorkspaceConfig(config, {
    path: resolveGoogleWorkspaceConfigPath(),
    force: options.force,
  })

  console.log('Google Workspaceの利用者別設定を保存しました。')
  console.log(`保存先: ${configPath}`)
  console.log('次回、GmailまたはCalendarを初めて使うとブラウザでGoogle認証が開きます。')
  console.log('ダウンロードしたclient_secret JSONはリポジトリ外へ移すか、安全に削除してください。')
} catch (error) {
  const code = /** @type {NodeJS.ErrnoException} */ (error).code
  if (code === 'EEXIST') {
    console.error('Google Workspace設定は既にあります。置き換える場合だけ --force を指定してください。')
  } else {
    console.error(error instanceof Error ? error.message : String(error))
  }
  process.exit(1)
}
