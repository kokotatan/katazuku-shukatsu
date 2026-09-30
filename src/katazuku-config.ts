/**
 * 自動運転ワークフローの設定(katazuku.config.json)を読み、既定値で埋めて検証する。
 *
 * 個人の値(Googleアカウント・署名・通知先)はコードやプロンプトに直書きせず、ここにだけ書く。
 * katazuku.config.json は gitignore 済み。雛形は katazuku.config.example.json。
 * 設定ファイルが無くても、デモ・dry-run が動くように安全側の既定値を持つ。
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { validateJsonSchema } from './agent-runtime.js'
import { repositoryRoot } from './database-path.js'

export type WorkflowName = 'mail-watch' | 'daily-sync' | 'asa' | 'evening-brief' | 'calendar-sync' | 'inbox-tidy' | 'watchdog'

export const WORKFLOW_NAMES: WorkflowName[] = [
  'mail-watch', 'daily-sync', 'asa', 'evening-brief', 'calendar-sync', 'inbox-tidy', 'watchdog',
]

export interface GoogleAccount {
  id: string
  email: string
  primary: boolean
  calendars: 'all-visible' | 'primary'
}

export interface KatazukuConfig {
  /** 読み込んだ設定ファイル。無ければ undefined(=既定値だけで動いている) */
  source?: string
  profile: {
    displayName: string
    graduationYear?: number
    timezone: string
    signature: string[]
    interviewReminders: string[]
  }
  google: {
    accounts: GoogleAccount[]
    credentialsDir: string
    calendarPastDays: number
    calendarFutureDays: number
  }
  agent: {
    providerOrder: string[]
    localModelWorkflows: string[]
  }
  notify: { selfEmail: boolean; desktop: boolean }
  mail: { searchTerms: string[]; promoSenderDomains: string[] }
  workflows: Record<WorkflowName, { enabled: boolean }>
}

/** 日次同期でメールを拾う既定の語(就活の定型語彙だけ。固有名詞は入れない) */
export const DEFAULT_MAIL_SEARCH_TERMS = [
  '選考', '面接', '面談', '採用', 'インターン', 'エントリー', '説明会', '適性検査',
  'エントリーシート', 'オファー', '内定', '不合格', 'お見送り', '書類', '提出', '締切',
  '保険', '証明書', 'Slack', 'ワークスペース', 'キックオフ', '交通費', '宿泊', '合格', '結果',
]

const WORKFLOW_KEYS: Record<string, WorkflowName> = {
  mailWatch: 'mail-watch',
  dailySync: 'daily-sync',
  asa: 'asa',
  eveningBrief: 'evening-brief',
  calendarSync: 'calendar-sync',
  inboxTidy: 'inbox-tidy',
  watchdog: 'watchdog',
}

/**
 * 設定上の provider 名を agent-runtime の ProviderId へ寄せる。
 * 利用者に見せる名前は「何で動くか」が分かる claude-cli / codex-cli、実行契約の内部IDは claude / codex。
 */
export function normalizeProviderName(name: string): string {
  const value = name.trim()
  if (value === 'claude-cli') return 'claude'
  if (value === 'codex-cli') return 'codex'
  return value
}

function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

function defaults(): KatazukuConfig {
  return {
    profile: { displayName: '', timezone: 'Asia/Tokyo', signature: [], interviewReminders: [] },
    google: {
      accounts: [],
      credentialsDir: join(homedir(), '.google_workspace_mcp', 'credentials'),
      calendarPastDays: 7,
      calendarFutureDays: 60,
    },
    agent: {
      providerOrder: ['claude', 'codex'],
      // 読み物・冪等な突合だけ。抽出を正本へ入れる daily-sync はローカルモデルへ流さない。
      localModelWorkflows: ['mail-watch', 'calendar-sync', 'asa', 'evening-brief'],
    },
    notify: { selfEmail: false, desktop: true },
    mail: { searchTerms: [...DEFAULT_MAIL_SEARCH_TERMS], promoSenderDomains: [] },
    workflows: {
      'mail-watch': { enabled: true },
      'daily-sync': { enabled: true },
      asa: { enabled: true },
      'evening-brief': { enabled: true },
      'calendar-sync': { enabled: true },
      'inbox-tidy': { enabled: false },
      watchdog: { enabled: true },
    },
  }
}

export function configPath(root: string = repositoryRoot(), env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.KATAZUKU_CONFIG?.trim() || join(root, 'katazuku.config.json'))
}

/** 生のJSONを既定値へ重ねて検証する。ファイルI/Oと分けてテストしやすくする。 */
export function resolveConfig(raw: unknown, source?: string, schemaRoot: string = repositoryRoot()): KatazukuConfig {
  const schema = JSON.parse(readFileSync(join(schemaRoot, 'schemas', 'katazuku-config.schema.json'), 'utf8'))
  const errors = validateJsonSchema(raw ?? {}, schema)
  if (errors.length) throw new Error(`設定ファイルが不正です${source ? `(${source})` : ''}:\n  ` + errors.slice(0, 10).join('\n  '))
  const input = (raw ?? {}) as Record<string, any>
  const config = defaults()
  config.source = source
  Object.assign(config.profile, input.profile ?? {})
  const google = input.google ?? {}
  if (google.accounts) {
    config.google.accounts = (google.accounts as any[]).map((account) => ({
      id: account.id,
      email: account.email,
      primary: Boolean(account.primary),
      calendars: account.calendars ?? (account.primary ? 'all-visible' : 'primary'),
    }))
  }
  if (google.credentialsDir) config.google.credentialsDir = expandHome(google.credentialsDir)
  if (google.calendarPastDays) config.google.calendarPastDays = google.calendarPastDays
  if (google.calendarFutureDays) config.google.calendarFutureDays = google.calendarFutureDays
  if (input.agent?.providerOrder) config.agent.providerOrder = [...new Set((input.agent.providerOrder as string[]).map(normalizeProviderName))]
  if (input.agent?.localModelWorkflows) config.agent.localModelWorkflows = input.agent.localModelWorkflows
  Object.assign(config.notify, input.notify ?? {})
  if (input.mail?.searchTerms?.length) config.mail.searchTerms = input.mail.searchTerms
  if (input.mail?.promoSenderDomains) config.mail.promoSenderDomains = input.mail.promoSenderDomains
  for (const [key, value] of Object.entries((input.workflows ?? {}) as Record<string, { enabled?: boolean }>)) {
    const name = WORKFLOW_KEYS[key]
    if (name && typeof value.enabled === 'boolean') config.workflows[name].enabled = value.enabled
  }
  const primaries = config.google.accounts.filter((account) => account.primary)
  if (config.google.accounts.length && primaries.length !== 1) {
    throw new Error('google.accounts の primary はちょうど1つだけ true にしてください')
  }
  if (new Set(config.google.accounts.map((account) => account.id)).size !== config.google.accounts.length) {
    throw new Error('google.accounts の id が重複しています')
  }
  return config
}

/** katazuku.config.json(または $KATAZUKU_CONFIG)を読む。無ければ既定値。 */
export function loadConfig(root: string = repositoryRoot(), env: NodeJS.ProcessEnv = process.env): KatazukuConfig {
  const path = configPath(root, env)
  if (!existsSync(path)) return resolveConfig({}, undefined, root)
  const raw = JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''))
  return resolveConfig(raw, path, root)
}

export function primaryAccount(config: KatazukuConfig): GoogleAccount | undefined {
  return config.google.accounts.find((account) => account.primary)
}

/**
 * ワークフローごとの provider 順。環境変数 KATAZUKU_AGENT_ORDER があればそれを優先する。
 * ローカルモデル(codex-oss)は localModelWorkflows に載っているワークフローだけに許す。
 * 逆(既定で全部許可し、危ないものを除外)にすると、新しいワークフローを足したときに
 * 黙ってローカルモデルへ流れてしまう。止まって気づく方が、誤った結果が正本へ入るより良い。
 */
export function providerOrderFor(config: KatazukuConfig, workflow: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const base = env.KATAZUKU_AGENT_ORDER?.trim()
    ? env.KATAZUKU_AGENT_ORDER.split(',').map(normalizeProviderName).filter(Boolean)
    : config.agent.providerOrder
  const allowLocal = config.agent.localModelWorkflows.includes(workflow)
  return [...new Set(base.filter((provider) => allowLocal || provider !== 'codex-oss'))]
}

/**
 * プロンプトの {{NAME}} を埋める。未知の差し込みが残ったら throw する
 * (差し込み漏れのまま agent に渡すと、空欄を推測で埋められてしまうため)。
 */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  const missing = new Set<string>()
  const out = template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key: string) => {
    if (!(key in vars)) {
      missing.add(key)
      return ''
    }
    return vars[key]
  })
  if (missing.size) throw new Error('プロンプトの差し込みが未定義です: ' + [...missing].join(', '))
  return out
}

/** プロンプトへ渡す共通の差し込み値。個人の値はすべて設定ファイル由来。 */
export function templateVars(config: KatazukuConfig, now: Date = new Date()): Record<string, string> {
  const primary = primaryAccount(config)
  const accounts = config.google.accounts.length
    ? config.google.accounts.map((account) => `- ${account.id} = ${account.email}${account.primary ? '(主アカウント: 就活予定はこのカレンダーへ)' : ''}`).join('\n')
    : '- (未設定: katazuku.config.json の google.accounts を設定してください)'
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: config.profile.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const weekday = new Intl.DateTimeFormat('ja-JP', { timeZone: config.profile.timezone, weekday: 'short' }).format(now)
  return {
    USER_NAME: config.profile.displayName || '本人',
    PRIMARY_ACCOUNT: primary?.email ?? '(未設定)',
    ACCOUNT_LIST: accounts,
    SIGNATURE: config.profile.signature.length ? config.profile.signature.join('\n') : '(署名未設定: katazuku.config.json の profile.signature)',
    TIMEZONE: config.profile.timezone,
    TODAY: `${date}(${weekday})`,
    PROMO_DOMAINS: config.mail.promoSenderDomains.length ? config.mail.promoSenderDomains.join(' / ') : '(未設定)',
    INTERVIEW_REMINDERS: config.profile.interviewReminders.length
      ? config.profile.interviewReminders.map((line) => '・' + line).join('\n')
      : '',
  }
}
