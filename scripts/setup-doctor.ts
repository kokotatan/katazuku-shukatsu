/** 実利用前のローカル診断。通信・ログイン・トークン更新・書き込みは行わない。 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import { detectCodexExtraCapabilities, resolveProviderCommands } from '../src/agent-runtime.js'
import { repositoryRoot } from '../src/database-path.js'
import { credentialPath } from '../src/google-auth.js'
import { configPath, loadConfig } from '../src/katazuku-config.js'
import { activeLabel, credentialsDir, isSiwcEnabled, loadCredential } from '../src/providers/chatgpt-siwc.js'

export interface SetupCheck {
  name: string
  status: 'pass' | 'missing' | 'unverified'
  detail: string
}

function isFile(path: string): boolean {
  try { return statSync(path).isFile() } catch { return false }
}

function supplied(value: unknown): value is string {
  return typeof value === 'string' && !!value.trim() && !/example|replace[-_ ]?me|your[-_ ]|^<.*>$/i.test(value)
}

function commandExists(command: string, env: NodeJS.ProcessEnv): boolean {
  if (isAbsolute(command) || /[/\\]/.test(command)) return isFile(command)
  const extensions = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : ['']
  return (env.PATH ?? '').split(delimiter).filter(Boolean)
    .some((dir) => extensions.some((extension) => isFile(join(dir, command + extension))))
}

/** 出力用の文言は固定値だけ。設定/例外/資格情報の内容を結果へ混ぜない。 */
export async function inspectSetup(
  root: string,
  options: { env?: NodeJS.ProcessEnv; commands?: Record<'claude' | 'codex' | 'codex-oss', string> } = {},
): Promise<SetupCheck[]> {
  const env = options.env ?? process.env
  const checks: SetupCheck[] = []
  const add = (name: string, ok: boolean, good: string, missing: string) => {
    checks.push({ name, status: ok ? 'pass' : 'missing', detail: ok ? good : missing })
  }
  if (!existsSync(configPath(root, env))) {
    add('個人設定', false, '', 'katazuku.config.example.json をコピーし、自分の設定を入力してください。docs/SETUP.md の1を参照。')
    return checks
  }
  let config
  try { config = loadConfig(root, env) } catch {
    add('個人設定', false, '', 'JSONまたは設定スキーマが不正です。docs/SETUP.md の1に沿って設定を確認してください。')
    return checks
  }
  const profileOk = supplied(config.profile.displayName) && config.profile.displayName !== '就活 太郎'
    && config.profile.signature.some(supplied)
    && config.profile.signature.every((line) => !/サンプル大学|就活 太郎|example\.(?:com|net|org)/i.test(line))
  add('個人設定', profileOk, '設定スキーマと呼び名・署名を確認しました。', '雛形の呼び名・署名を自分の値に置き換えてください。')
  let timezoneOk = true
  try { new Intl.DateTimeFormat('ja-JP', { timeZone: config.profile.timezone }) } catch { timezoneOk = false }
  add('タイムゾーン', timezoneOk, 'タイムゾーンの形式を確認しました。', 'profile.timezone に有効なIANAタイムゾーンを指定してください。')
  const accountsOk = config.google.accounts.length > 0 && config.google.accounts.every((account) =>
    /^[^\s@/\\]+@[^\s@/\\]+\.[^\s@/\\]+$/.test(account.email) && !/@(?:[^@]+\.)?example\.(?:com|net|org)$/i.test(account.email))
  add('Google対象アカウント', accountsOk, '対象アカウントと主アカウントの設定を確認しました。', 'google.accounts に自分のアカウントを指定してください。雛形のアカウントは使えません。')
  if (accountsOk) {
    const tokensOk = config.google.accounts.every((account) => {
      try {
        const stored = JSON.parse(readFileSync(credentialPath(config.google.credentialsDir, account.email), 'utf8')) as Record<string, unknown>
        return supplied(stored.refresh_token) && supplied(stored.client_id || env.GOOGLE_OAUTH_CLIENT_ID)
          && supplied(stored.client_secret || env.GOOGLE_OAUTH_CLIENT_SECRET)
      } catch { return false }
    })
    add('Google資格情報', tokensOk, '保存済み資格情報の必要項目を確認しました。有効性・権限は未確認です。読取り専用の資格情報だけではMCPの下書き・書込みは利用できません。', '対象アカウントの保存済みトークンまたはOAuthクライアント情報が不足しています。npm run google:connect または docs/GOOGLE-CONNECTION.md を参照。')
  }
  const commands = options.commands ?? await resolveProviderCommands(env)
  const known = ['claude', 'codex', 'codex-oss', 'anthropic-api', 'openai-api', 'chatgpt-siwc']
  add('AIの選択', config.agent.providerOrder.every((provider) => known.includes(provider)), 'AIの種類を確認しました。', '未対応のAI名があります。docs/AI-PROVIDERS.md にある名前を選んでください。')
  const available = config.agent.providerOrder.filter((provider) => {
    if (provider === 'claude' || provider === 'codex' || provider === 'codex-oss') return commandExists(commands[provider], env)
    if (provider === 'anthropic-api') return supplied(env.ANTHROPIC_API_KEY)
    if (provider === 'openai-api') return supplied(env.OPENAI_API_KEY) && supplied(env.KATAZUKU_OPENAI_MODEL)
    if (provider === 'chatgpt-siwc' && isSiwcEnabled(env)) {
      try {
        const dir = credentialsDir(env)
        const label = activeLabel(dir)
        const record = label ? loadCredential(dir, label) : undefined
        return !!record?.plan_usage_enabled && record.scopes?.includes('chatgpt.tokens.use.direct')
          && supplied(record.access_token) && supplied(record.refresh_token)
      } catch { return false }
    }
    return false
  })
  add('AIのローカル準備', available.length > 0, '選択したAIの少なくとも1つにローカル実行の前提があります。認証・利用枠・モデルは未確認です。', '選択したAIのCLI、APIキーとモデル、またはChatGPTサインイン情報が見つかりません。docs/AI-PROVIDERS.md を参照。')
  const toolWorkflows = ['mail-watch', 'asa', 'evening-brief', 'inbox-tidy'] as const
  const needsTools = toolWorkflows.some((name) => config.workflows[name].enabled)
  add('ツールを使う工程', !needsTools || available.some((provider) => provider === 'claude' || provider === 'codex'),
    '有効な工程に必要なAIの種類を確認しました。Google MCPの実接続は未確認です。',
    'メール見張り・朝のまとめ等にはClaude CodeまたはCodexが必要です。接続するか、未対応の工程を設定で無効にしてください。')
  if (needsTools && available.includes('codex') && !available.includes('claude')) {
    const capabilities = await detectCodexExtraCapabilities(root)
    add('Codex Google MCP設定', capabilities.includes('gmail.read') && capabilities.includes('calendar.read'),
      'プロジェクトのGoogle MCP設定を検出しました。起動・認証・権限は未確認です。',
      'プロジェクトにgoogle-workspaceのMCP設定がありません。CLIのユーザー設定だけでは能力を認識できません。docs/GOOGLE-CONNECTION.md を参照。')
  }
  checks.push({ name: '実接続・定期実行', status: 'unverified', detail: '通信・ログイン・トークン更新・定期登録は実行していません。Google MCP接続、読み取り確認、試し実行後に定期登録してください。docs/GOOGLE-CONNECTION.md / docs/SETUP.md を参照。' })
  return checks
}

export function formatSetupChecks(checks: SetupCheck[]): string {
  return ['実利用前の診断（ローカル確認のみ）', ...checks.map((check) =>
    `[${check.status === 'pass' ? '確認済' : check.status === 'missing' ? '要対応' : '未確認'}] ${check.name}: ${check.detail}`),
  checks.some((check) => check.status === 'missing')
    ? '不足があります。対応してから再診断してください。'
    : 'ローカルの前提を確認しました。実接続と定期実行の成功は別途確認が必要です。'].join('\n')
}

if (process.argv[1] && /(^|[/\\])setup-doctor\.ts$/.test(process.argv[1])) {
  const root = repositoryRoot()
  try {
    if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'))
    const checks = await inspectSetup(root)
    console.log(formatSetupChecks(checks))
    process.exitCode = checks.some((check) => check.status === 'missing') ? 1 : 0
  } catch {
    console.error('診断できませんでした。.env と個人設定の形式・読み取り権限を確認してください。値は表示しません。')
    process.exitCode = 1
  }
}
