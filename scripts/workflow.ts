/**
 * 自動運転ワークフローの入口(OSに依存しない Node 実装)。スケジューラからはこれだけを呼ぶ。
 *
 *   npm run workflow -- <name> [--dry-run] [--agent claude|codex|codex-oss|auto]
 *
 *   mail-watch     毎時: 未読の見張り → 緊急は返信「下書き」+ カレンダー登録 + デスクトップ通知
 *   daily-sync     毎朝: Gmail を決定的に取得 → 読み取り専用のエージェントが厳格JSONを抽出 → 検証 → 正本DBへ反映
 *   asa            毎朝: 「きょうやること」最大3件のまとめ(故障報告・提出物・送り忘れ・締切ブロック)
 *   evening-brief  毎晩: 明日の面接・面談の前夜ブリーフ(予定が無い日はエージェントを呼ばない)
 *   calendar-sync  30分ごと: Google Calendar → DB(LLMなし)。企業を特定できない予定だけエージェントへ
 *   inbox-tidy     任意: 受信トレイの既読化(DBには触れない)
 *   watchdog       4時間ごと: 各ワークフローが止まっていないかの番犬(LLMなし)
 *
 * 安全境界: 無人のワークフローは第三者へメールを送らない(下書きまで)。本人宛の通知メールは
 * notify.selfEmail=true のときだけ。フォーム送信・予約確定・提出はどの工程でも行わない。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { applyCalendar } from '../src/db-apply-calendar.js'
import type { MailInput } from '../src/daily-sync-input.js'
import { openDb } from '../src/db.js'
import { repositoryRoot, resolveDatabasePath } from '../src/database-path.js'
import {
  applyDailySyncResult,
  buildExtractionBatches,
  DAILY_SYNC_SCHEMA_PATH,
  mergeExtractionResults,
  parseModelJson,
} from '../src/daily-sync.js'
import {
  loadConfig,
  primaryAccount,
  providerOrderFor,
  renderTemplate,
  templateVars,
  type KatazukuConfig,
  type WorkflowName,
  WORKFLOW_NAMES,
} from '../src/katazuku-config.js'
import {
  acquireLock,
  appendActivity,
  clearAlert,
  describeFailure,
  hasSentinel,
  listAlerts,
  notifyDesktop,
  parseCliFlags,
  pruneFiles,
  readActivity,
  recordAlert,
  runAgentStep,
  runIdFor,
  sentinelFor,
} from '../src/workflow-support.js'
import { getBriefData, localDate } from './brief-data.js'
import { runCalendarFetch, utcOffsetFor } from './calendar-fetch.js'
import { fetchGmail } from './gmail-fetch.js'
import { writeSubmissionReadiness } from './submission-readiness.js'

const ROOT = repositoryRoot()
// スケジューラから起動されると PATH などが最小になる。KATAZUKU_CLAUDE_COMMAND 等は gitignore 済みの .env に置く
if (existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'))
const LOGS = join(ROOT, 'logs')
const MINUTE = 60_000

interface Context {
  config: KatazukuConfig
  dryRun: boolean
  agent: string
  force: boolean
  now: Date
  log: (line: string) => void
}

function readPrompt(name: string): string {
  return readFileSync(join(ROOT, 'scripts', name), 'utf8')
}

function stamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
}

/** tsx でリポジトリ内のスクリプトを子プロセスとして走らせる(import すると副作用がある CLI 用) */
function runTsx(script: string, args: string[] = []): { ok: boolean; output: string } {
  const cli = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  const result = spawnSync(process.execPath, [cli, script, ...args], { cwd: ROOT, encoding: 'utf8', env: process.env })
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

function refreshSubmissionReadiness(ctx: Context): void {
  try {
    const db = openDb(resolveDatabasePath())
    try {
      writeSubmissionReadiness(db, {
        write: join(LOGS, 'submission-readiness.local.json'),
        alert: join(LOGS, 'submission-readiness-alert.local.txt'),
        now: ctx.now,
      })
    } finally {
      db.close()
    }
  } catch (error) {
    ctx.log(`提出物ガードの更新に失敗: ${(error as Error).message}`)
  }
}

function deliveryInstructions(config: KatazukuConfig, subject: string): string {
  const primary = primaryAccount(config)
  if (config.notify.selfEmail && primary) {
    return [
      `- 出力したまとめの全文を、件名『${subject}』で \`mcp__google-workspace__send_gmail_message\` を使い **${primary.email} 宛(本人宛)だけ**に送る`,
      '  (body_format=plain、本文はプレーンテキスト)。送信ツールはこの本人宛の送信にだけ使う。企業・採用担当への送信には絶対に使わない。',
      '- メールの送信に成功した場合だけ完了とする。',
    ].join('\n')
  }
  return '- メールは送らない。まとめは標準出力にそのまま出す(ワークフローが logs/briefs/ に保存し、デスクトップ通知で知らせる)。'
}

function sendPolicy(config: KatazukuConfig): string {
  const primary = primaryAccount(config)
  return config.notify.selfEmail && primary
    ? `- 例外は1つだけ: 最後のまとめを本人(${primary.email})宛てに送ること。それ以外の宛先には送らない。`
    : '- この実行ではメールを一切送らない(本人宛も含む)。'
}

function capabilitiesWithSelfSend(config: KatazukuConfig, base: string[]): string[] {
  return config.notify.selfEmail && primaryAccount(config) ? [...base, 'gmail.send.self'] : base
}

function saveBrief(kind: string, date: string, text: string): string {
  const dir = join(LOGS, 'briefs')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${kind}-${date}.local.md`)
  writeFileSync(path, text.replace(/^\s*===\s*[a-z-]+\s*DONE\s*===\s*$/gm, '').trim() + '\n', 'utf8')
  return path
}

function dryRunReport(ctx: Context, workflow: string, prompt: string, capabilities: string[]): void {
  console.log(`[dry-run] workflow=${workflow}`)
  console.log(`[dry-run] provider順: ${providerOrderFor(ctx.config, workflow).join(' -> ')}`)
  console.log(`[dry-run] capabilities: ${capabilities.join(', ') || '(なし)'}`)
  console.log('[dry-run] ---- プロンプト(先頭2000字) ----')
  console.log(prompt.slice(0, 2000))
}

// ---------------------------------------------------------------- mail-watch

async function mailWatch(ctx: Context): Promise<boolean> {
  const notifyFile = join(LOGS, 'mail-watch-notify.txt')
  const before = existsSync(notifyFile) ? readFileSync(notifyFile, 'utf8').split(/\r?\n/).filter(Boolean).length : 0
  const prompt = renderTemplate(readPrompt('mail-watch-prompt.md'), { ...templateVars(ctx.config, ctx.now), SENTINEL: sentinelFor('mail-watch') })
  const capabilities = ['workspace.read', 'workspace.write', 'shell', 'web.search', 'gmail.read', 'gmail.draft', 'calendar.read', 'calendar.write']
  if (ctx.dryRun) { dryRunReport(ctx, 'mail-watch', prompt, capabilities); return true }
  refreshSubmissionReadiness(ctx)
  const result = await runAgentStep({
    config: ctx.config, workflow: 'mail-watch', runId: runIdFor('mail-watch', ctx.now), prompt, capabilities,
    risk: 'external-draft', sideEffectMode: 'reconcile', timeoutMs: 30 * MINUTE, agent: ctx.agent,
  })
  const output = result.output ?? ''
  ctx.log(output)
  if (result.status !== 'succeeded') throw new Error('エージェント実行に失敗: ' + describeFailure(result))
  if (!hasSentinel(output, 'mail-watch')) throw new Error('完了行がない(途中終了・通信失敗の可能性)')
  // 「未読N件中…」の規定要約が無い出力は、プロンプトが渡らず対話応答になった可能性がある
  if (!/未読/.test(output)) throw new Error('規定の要約(「未読N件中…」)が無い')
  if (ctx.config.notify.desktop && existsSync(notifyFile)) {
    const lines = readFileSync(notifyFile, 'utf8').split(/\r?\n/).filter(Boolean).slice(before)
    for (const line of lines) {
      const [tag, title, body] = line.split('|', 3)
      if (tag === 'TOAST' && title && body) notifyDesktop('katazuku ' + title, body)
    }
  }
  pruneFiles(LOGS, /^mail-watch-requirements-.+\.local\.json$/, 14, ctx.now)
  return true
}

// ---------------------------------------------------------------- daily-sync

function lookbackDays(now: Date, markerPath: string): number {
  // PCが数日止まっていた後の実行で、停止中のメールを落とさないよう前回成功時刻から期間を広げる(最大30日)
  if (!existsSync(markerPath)) return 7
  const last = Date.parse(readFileSync(markerPath, 'utf8').trim())
  if (Number.isNaN(last)) return 7
  return Math.min(30, Math.max(1, Math.ceil((now.getTime() - last) / 86_400_000) + 1))
}

async function dailySync(ctx: Context): Promise<boolean> {
  const ts = stamp(ctx.now)
  const runId = runIdFor('daily-sync', ctx.now)
  const marker = join(LOGS, 'daily-sync-last-success.local.txt')
  const days = lookbackDays(ctx.now, marker)
  const basePrompt = readPrompt('daily-sync-extract-prompt.md')
  const schemaText = readFileSync(DAILY_SYNC_SCHEMA_PATH, 'utf8')
  if (ctx.dryRun) {
    dryRunReport(ctx, 'daily-sync', basePrompt, [])
    console.log(`[dry-run] メール取得期間: 直近${days}日 / 対象: ${ctx.config.google.accounts.map((account) => account.id).join(', ') || '(未設定)'}`)
    return true
  }
  ctx.log(`メール取得期間: 直近${days}日`)
  const mail = await fetchGmail(ctx.config, { days })
  const mailPath = join(LOGS, `daily-sync-mail-${ts}.local.json`)
  writeFileSync(mailPath, JSON.stringify(mail), 'utf8')
  if (!mail.accounts.length || mail.accounts.some((account) => account.status === 'failed')) {
    throw new Error('Gmailの取得が一部または全部失敗(成功時刻は更新しない): ' + mail.accounts.map((a) => `${a.account}:${a.status}${a.error ? `(${a.error})` : ''}`).join(' / '))
  }
  if (mail.failedMessages.length) {
    // 本文を取れなかった通は専用の alert に残す。翌日の取得期間は前回成功時刻+1日なので翌朝また拾われる
    recordAlert('daily-sync-mail', `本文を取得できなかったメール${mail.failedMessages.length}通を除いて反映`, mailPath, ROOT, ctx.now)
  } else {
    clearAlert('daily-sync-mail', ROOT)
  }
  const input: MailInput = { accounts: mail.accounts, messages: mail.messages }
  const parts: { input: MailInput; output: unknown }[] = []
  const batches = mail.messages.length ? buildExtractionBatches(input, basePrompt, schemaText) : []
  for (const [index, batch] of batches.entries()) {
    ctx.log(`メール抽出: ${index + 1}/${batches.length}(${batch.input.messages.length}通)`)
    const result = await runAgentStep({
      config: ctx.config, workflow: 'daily-sync', runId: `${runId}:batch-${index + 1}`, prompt: batch.prompt,
      // 本文をプロンプトへ埋め込むので、ツールは何も渡さない(読み取り専用・副作用なし)
      capabilities: [], risk: 'read-only', sideEffectMode: 'none', timeoutMs: 20 * MINUTE,
      outputSchemaPath: DAILY_SYNC_SCHEMA_PATH, agent: ctx.agent,
    })
    if (result.status !== 'succeeded' || !result.output) throw new Error(`抽出に失敗(バッチ${index + 1}): ` + describeFailure(result))
    parts.push({ input: batch.input, output: parseModelJson(result.output) })
  }
  const merged = mergeExtractionResults(input, parts)
  const extractPath = join(LOGS, `daily-sync-extract-${ts}.local.json`)
  writeFileSync(extractPath, JSON.stringify(merged, null, 2), 'utf8')

  const db = openDb(resolveDatabasePath())
  let summary
  try {
    summary = applyDailySyncResult(db, merged, { force: ctx.force })
  } finally {
    db.close()
  }
  ctx.log([
    'daily-sync 反映:',
    `  選考: 更新 ${summary.selections.updated.length} / 追加 ${summary.selections.added.length} / 保留 ${summary.selections.skipped.length} / 名寄せ要確認 ${summary.selections.pending.length}`,
    `  未完了提出物: 追加 ${summary.requirements.created} / 更新 ${summary.requirements.updated} / 完了反映 ${summary.requirements.completed}`,
    `  メール: 追加 ${summary.mail.created} / 更新 ${summary.mail.updated}`,
    `  提出結果: 追加 ${summary.submissions.created} / 既反映 ${summary.submissions.duplicate}`,
    ...summary.priorityMails.map((mailItem) => `  最優先メール: ${mailItem.subject}(${mailItem.reason})`),
    ...[...summary.submissions.errors, ...summary.requirements.errors, ...summary.selections.errors].map((error) => `  失敗: ${error}`),
  ].join('\n'))

  const snapshot = runTsx('scripts/snapshot.ts', [resolveDatabasePath()])
  if (!snapshot.ok) throw new Error('snapshot の書き出しに失敗: ' + snapshot.output.slice(-400))
  appendActivity({
    by: 'daily-sync', action: '毎朝の選考同期(抽出と決定論的反映を分離)',
    why: 'モデルにDB書き込みを委ねず、Schemaと網羅性を検証した抽出結果だけを反映するため',
    how: `メール${mail.messages.length}通 / バッチ${batches.length} / 抽出=${extractPath.split(/[\\/]/).pop()}`,
    result: '成功',
  }, ROOT, ctx.now)
  writeFileSync(marker, ctx.now.toISOString(), 'utf8')
  refreshSubmissionReadiness(ctx)
  pruneFiles(LOGS, /^daily-sync-(mail|extract)-.+\.local\.json$/, 30, ctx.now)

  if (ctx.config.workflows['inbox-tidy'].enabled) {
    // 後片付けは契約の外(DBに触れない外部副作用)。失敗しても朝の同期は成功のまま、専用 alert だけ残す
    try {
      await inboxTidy(ctx)
      clearAlert('inbox-tidy', ROOT)
    } catch (error) {
      recordAlert('inbox-tidy', (error as Error).message, undefined, ROOT, ctx.now)
    }
  }
  return true
}

// ---------------------------------------------------------------- inbox-tidy

async function inboxTidy(ctx: Context): Promise<boolean> {
  const prompt = renderTemplate(readPrompt('inbox-tidy-prompt.md'), { ...templateVars(ctx.config, ctx.now), SENTINEL: sentinelFor('inbox-tidy') })
  const capabilities = ['workspace.read', 'gmail.read', 'gmail.labels']
  if (ctx.dryRun) { dryRunReport(ctx, 'inbox-tidy', prompt, capabilities); return true }
  const result = await runAgentStep({
    config: ctx.config, workflow: 'inbox-tidy', runId: runIdFor('inbox-tidy', ctx.now, 'day'), prompt, capabilities,
    risk: 'external-commit', sideEffectMode: 'reconcile', timeoutMs: 20 * MINUTE, agent: ctx.agent,
  })
  ctx.log(result.output ?? '')
  if (result.status !== 'succeeded' || !hasSentinel(result.output ?? '', 'inbox-tidy')) throw new Error('受信トレイ整理が完了しなかった: ' + describeFailure(result))
  return true
}

// ---------------------------------------------------------------- watchdog

interface WatchdogReport { problems: string[]; keys: string[] }

const EXPECTED_HOURS: Partial<Record<WorkflowName, number>> = {
  'daily-sync': 30, 'mail-watch': 12, asa: 30, 'calendar-sync': 3, 'evening-brief': 30,
}

export function checkWatchdog(config: KatazukuConfig, now: Date, root: string = ROOT): WatchdogReport {
  const problems: string[] = []
  const keys: string[] = []
  const lastSeen = new Map<string, number>()
  for (const entry of readActivity(root)) {
    const at = Date.parse(entry.ts)
    if (!Number.isNaN(at) && at > (lastSeen.get(entry.by) ?? 0)) lastSeen.set(entry.by, at)
  }
  for (const [name, hours] of Object.entries(EXPECTED_HOURS) as [WorkflowName, number][]) {
    if (!config.workflows[name].enabled) continue
    const last = lastSeen.get(name)
    if (last === undefined) {
      problems.push(`${name}: 実行記録がない(スケジューラ未登録か、一度も成功していない)`)
      keys.push(`norecord:${name}`)
    } else if (now.getTime() - last > hours * 3_600_000) {
      problems.push(`${name}: 最終成功が${Math.round((now.getTime() - last) / 3_600_000)}時間前(期待は${hours}時間以内)`)
      keys.push(`stale:${name}`)
    }
  }
  // provider がすべて利用枠切れで休止中なら、全ワークフローが止まる
  const healthPath = join(root, 'logs', 'agent-runs', 'provider-health.local.json')
  if (existsSync(healthPath)) {
    try {
      const health = JSON.parse(readFileSync(healthPath, 'utf8')) as { providers?: Record<string, { unavailableUntil?: string }> }
      const order = config.agent.providerOrder
      const blocked = order.filter((provider) => Date.parse(health.providers?.[provider]?.unavailableUntil ?? '') > now.getTime())
      if (order.length && blocked.length === order.length) {
        problems.push(`AIプロバイダ(${blocked.join(', ')})がすべて利用枠切れで休止中`)
        keys.push('providers-exhausted')
      }
    } catch {
      // 壊れた健康状態ファイルは agent-runtime が次回再生成する
    }
  }
  for (const alert of listAlerts(root).filter((item) => item.name !== 'watchdog')) {
    problems.push(`${alert.name}: ${alert.text.split(/\r?\n/).pop()}`)
    keys.push(`alert:${alert.name}`)
  }
  return { problems, keys }
}

async function watchdog(ctx: Context): Promise<boolean> {
  const report = checkWatchdog(ctx.config, ctx.now)
  if (ctx.dryRun) {
    ctx.log('[dry-run] 番犬: ' + (report.problems.join(' / ') || '異常なし'))
    return true
  }
  const summaryPath = join(LOGS, 'watchdog-summary.local.txt')
  writeFileSync(join(LOGS, 'watchdog-heartbeat.txt'), ctx.now.toISOString(), 'utf8')
  if (!report.problems.length) {
    if (existsSync(summaryPath)) writeFileSync(summaryPath, '', 'utf8')
    ctx.log('番犬: 異常なし')
    return true
  }
  writeFileSync(summaryPath, report.problems.join('\n') + '\n', 'utf8')
  ctx.log('番犬: ' + report.problems.join(' / '))
  // 同じ問題で4時間ごとに鳴り続けないよう、問題の組み合わせ(揮発値を含まない鍵)が変わった時だけ通知する
  const fingerprintPath = join(LOGS, 'watchdog-last.local.txt')
  const fingerprint = [...report.keys].sort().join('|')
  const previous = existsSync(fingerprintPath) ? readFileSync(fingerprintPath, 'utf8') : ''
  if (fingerprint !== previous && ctx.config.notify.desktop && !ctx.dryRun) {
    notifyDesktop('katazuku 番犬', `自動運転の異常 ${report.problems.length}件。logs/watchdog-summary.local.txt を確認`)
  }
  writeFileSync(fingerprintPath, fingerprint, 'utf8')
  return true
}

// ---------------------------------------------------------------- asa

async function asa(ctx: Context): Promise<boolean> {
  if (!ctx.dryRun) refreshSubmissionReadiness(ctx)
  const reported = checkWatchdog(ctx.config, ctx.now)
  if (!ctx.dryRun) writeFileSync(join(LOGS, 'watchdog-summary.local.txt'), reported.problems.join('\n') + (reported.problems.length ? '\n' : ''), 'utf8')
  const vars = templateVars(ctx.config, ctx.now)
  const date = localDate(ctx.config.profile.timezone, 0, ctx.now)
  const prompt = renderTemplate(readPrompt('asa-prompt.md'), {
    ...vars,
    SENTINEL: sentinelFor('asa'),
    SEND_POLICY: sendPolicy(ctx.config),
    DELIVERY: deliveryInstructions(ctx.config, `きょうやること (${vars.TODAY})`),
    CALENDAR_EXPORT: renderTemplate(readPrompt('calendar-export-prompt.md'), vars),
  })
  const capabilities = capabilitiesWithSelfSend(ctx.config, ['workspace.read', 'workspace.write', 'shell', 'web.search', 'gmail.read', 'gmail.draft', 'calendar.read', 'calendar.write'])
  if (ctx.dryRun) { dryRunReport(ctx, 'asa', prompt, capabilities); return true }
  const result = await runAgentStep({
    config: ctx.config, workflow: 'asa', runId: runIdFor('asa', ctx.now, 'day'), prompt, capabilities,
    risk: ctx.config.notify.selfEmail ? 'external-commit' : 'external-draft', sideEffectMode: 'reconcile', timeoutMs: 60 * MINUTE, agent: ctx.agent,
  })
  const output = result.output ?? ''
  if (result.status !== 'succeeded') throw new Error('エージェント実行に失敗: ' + describeFailure(result))
  if (!hasSentinel(output, 'asa')) throw new Error('完了行がない(きょうやることが届いていない可能性)')
  const path = saveBrief('asa', date, output)
  ctx.log(`朝のまとめ: ${path}`)
  // 報告済みの故障 alert は消す(翌日また同じものを出さない。再発すれば各ジョブが書き直す)
  for (const alert of listAlerts(ROOT)) if (reported.keys.includes(`alert:${alert.name}`)) clearAlert(alert.name, ROOT)
  if (ctx.config.notify.desktop) notifyDesktop('katazuku 朝のまとめ', 'きょうやることをまとめました')
  return true
}

// ---------------------------------------------------------------- evening-brief

async function eveningBrief(ctx: Context): Promise<boolean> {
  const date = localDate(ctx.config.profile.timezone, 1, ctx.now)
  if (ctx.dryRun && !existsSync(resolveDatabasePath())) {
    ctx.log('正本DBがまだ無いため、ブリーフの対象予定は0件として扱う(dry-run)')
    return true
  }
  const db = ctx.dryRun ? new DatabaseSync(resolveDatabasePath(), { readOnly: true }) : openDb(resolveDatabasePath())
  let data
  try {
    if (ctx.dryRun) db.exec('PRAGMA busy_timeout = 5000')
    data = getBriefData(db, date, utcOffsetFor(ctx.config.profile.timezone, ctx.now))
  } finally {
    db.close()
  }
  if (data.count === 0) {
    // 予定が無い日はエージェントを呼ばない(利用枠を判断の要る処理に残す)
    ctx.log(`明日(${date})の対象予定は0件。ブリーフは作らない`)
    return true
  }
  const reminders = ctx.config.profile.interviewReminders
  const prompt = renderTemplate(readPrompt('evening-brief-prompt.md'), {
    ...templateVars(ctx.config, ctx.now),
    SENTINEL: sentinelFor('evening-brief'),
    BRIEF_DATE: date,
    BRIEF_DATA: JSON.stringify(data, null, 1),
    REMINDER_SECTION: reminders.length
      ? '   - 全予定の後に、次の「自分で決めた心構え」を毎回そのまま載せる(省略・言い換えをしない):\n' + reminders.map((line) => `     ・${line}`).join('\n')
      : '',
    DELIVERY: deliveryInstructions(ctx.config, `【前夜ブリーフ】${date} 予定${data.count}件`),
  })
  const capabilities = capabilitiesWithSelfSend(ctx.config, ['workspace.read', 'workspace.write', 'shell', 'web.search', 'gmail.read'])
  if (ctx.dryRun) { dryRunReport(ctx, 'evening-brief', prompt, capabilities); return true }
  const result = await runAgentStep({
    config: ctx.config, workflow: 'evening-brief', runId: runIdFor('evening-brief', ctx.now, 'day'), prompt, capabilities,
    risk: ctx.config.notify.selfEmail ? 'external-commit' : 'db-write', sideEffectMode: 'reconcile', timeoutMs: 20 * MINUTE, agent: ctx.agent,
  })
  const output = result.output ?? ''
  if (result.status !== 'succeeded') throw new Error('エージェント実行に失敗: ' + describeFailure(result))
  if (!hasSentinel(output, 'evening-brief')) throw new Error('完了行がない')
  const path = saveBrief('evening', date, output)
  ctx.log(`前夜ブリーフ: ${path}`)
  // ロック画面に出るので企業名・人名は載せない
  if (ctx.config.notify.desktop) notifyDesktop('katazuku 前夜ブリーフ', `明日の予定${data.count}件のブリーフを用意しました`)
  return true
}

// ---------------------------------------------------------------- calendar-sync

async function calendarSync(ctx: Context): Promise<boolean> {
  if (ctx.dryRun) {
    console.log(`[dry-run] calendar-sync: 対象 ${ctx.config.google.accounts.map((account) => `${account.id}(${account.calendars})`).join(', ') || '(未設定)'}`)
    console.log(`[dry-run] 取得範囲: 過去${ctx.config.google.calendarPastDays}日〜未来${ctx.config.google.calendarFutureDays}日 / 要判定の予定だけエージェントへ`)
    return true
  }
  if (!ctx.config.google.accounts.length) throw new Error('google.accounts が未設定です(katazuku.config.json)')
  const importPath = join(LOGS, 'calendar-import.local.json')
  const fetched = await runCalendarFetch(importPath, ctx.config)
  const input = JSON.parse(readFileSync(importPath, 'utf8'))
  const db = openDb(resolveDatabasePath())
  try {
    const applied = applyCalendar(input, db)
    ctx.log(`カレンダー反映: 追加${applied.created} / 更新${applied.updated} / 変化なし${applied.unchanged} / 昇格${applied.promoted}`)
  } finally {
    db.close()
  }
  const snapshot = runTsx('scripts/snapshot.ts', [resolveDatabasePath()])
  if (!snapshot.ok) throw new Error('snapshot の書き出しに失敗: ' + snapshot.output.slice(-400))

  // 企業を特定できない予定だけ判断を借りる。一度見せた externalId は記録し、新しく現れた時だけ起動する
  const residue = (JSON.parse(readFileSync(fetched.residuePath, 'utf8')) as { events: { externalId: string }[] }).events
  const seenPath = join(LOGS, 'calendar-residue-seen.local.json')
  const seen: string[] = existsSync(seenPath) ? JSON.parse(readFileSync(seenPath, 'utf8')) : []
  const fresh = residue.filter((event) => !seen.includes(event.externalId))
  if (fresh.length) {
    ctx.log(`要判定${residue.length}件(新規${fresh.length}件)をエージェントへ回す`)
    const prompt = renderTemplate(readPrompt('calendar-residue-prompt.md'), {
      ...templateVars(ctx.config, ctx.now), SENTINEL: sentinelFor('calendar-residue'), RESIDUE: JSON.stringify({ events: residue }, null, 1),
    })
    try {
      const result = await runAgentStep({
        config: ctx.config, workflow: 'calendar-sync', runId: runIdFor('calendar-residue', ctx.now), prompt,
        capabilities: ['workspace.read', 'workspace.write', 'shell'], risk: 'db-write', sideEffectMode: 'reconcile',
        timeoutMs: 10 * MINUTE, agent: ctx.agent,
      })
      ctx.log(result.output ?? describeFailure(result))
    } catch (error) {
      // 確定分の同期は済んでいる。要判定は次回に持ち越す(失敗にしない)
      ctx.log('要判定の処理はできなかった(次回再試行): ' + (error as Error).message)
    }
    writeFileSync(seenPath, JSON.stringify([...new Set([...seen, ...fresh.map((event) => event.externalId)])].slice(-500)), 'utf8')
  }
  appendActivity({
    by: 'calendar-sync', action: 'カレンダー予定のDB同期', why: '予定と空き判定を最新にするため',
    how: `決定的取得(LLMなし)。確定${fetched.written}件 / 要判定${fetched.residue}件`, result: '成功',
  }, ROOT, ctx.now)
  return true
}

// ---------------------------------------------------------------- 入口

const HANDLERS: Record<WorkflowName, (ctx: Context) => Promise<boolean>> = {
  'mail-watch': mailWatch,
  'daily-sync': dailySync,
  asa,
  'evening-brief': eveningBrief,
  'calendar-sync': calendarSync,
  'inbox-tidy': inboxTidy,
  watchdog,
}

/** 二重起動とみなすまでの時間(前回が固まっていたら、この時間を過ぎたロックは回収する) */
const LOCK_MINUTES: Record<WorkflowName, number> = {
  'mail-watch': 40, 'daily-sync': 90, asa: 75, 'evening-brief': 30, 'calendar-sync': 25, 'inbox-tidy': 30, watchdog: 10,
}

async function main(): Promise<void> {
  const name = process.argv[2] as WorkflowName
  if (!WORKFLOW_NAMES.includes(name)) {
    console.error(`使い方: npm run workflow -- <${WORKFLOW_NAMES.join('|')}> [--dry-run] [--agent auto|claude|codex|codex-oss]`)
    process.exit(1)
  }
  const flags = parseCliFlags(process.argv.slice(3))
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (!(major >= 24 || (major === 22 && minor >= 13))) {
    console.error('Node.js 22.13以降の22系、または24以降(推奨24)を使ってください。')
    process.exitCode = 1
    return
  }
  const config = loadConfig(ROOT)
  if (!config.workflows[name].enabled && !flags.dryRun) {
    console.log(`${name} は katazuku.config.json で無効です`)
    return
  }
  const now = new Date()
  if (!flags.dryRun) mkdirSync(LOGS, { recursive: true })
  const logFile = join(LOGS, `${name}-${stamp(now).slice(0, 8)}.log`)
  const log = (line: string) => {
    if (!line) return
    const text = `[${new Date().toISOString()}] ${line}\n`
    if (!flags.dryRun) writeFileSync(logFile, text, { flag: 'a' })
    process.stdout.write(text)
  }
  const release = flags.dryRun ? () => {} : acquireLock(name, LOCK_MINUTES[name] * MINUTE, ROOT, now)
  if (!release) {
    console.log(`${name} は実行中です(二重起動を防止しました)`)
    return
  }
  try {
    log(`===== ${name} 開始${flags.dryRun ? '(dry-run)' : ''} =====`)
    await HANDLERS[name]({ config, dryRun: flags.dryRun, agent: flags.agent, force: flags.force, now, log })
    if (!flags.dryRun) {
      clearAlert(name, ROOT)
      if (name !== 'daily-sync' && name !== 'calendar-sync') {
        appendActivity({ by: name, action: `${name} 完了`, why: '定常の自動運転', result: '成功' }, ROOT, now)
      }
    }
    log(sentinelFor(name))
  } catch (error) {
    const message = (error as Error).message
    log(`失敗: ${message}`)
    if (!flags.dryRun) recordAlert(name, message, logFile.split(/[\\/]/).pop(), ROOT, now)
    process.exitCode = 1
  } finally {
    release()
    if (!flags.dryRun) {
      pruneFiles(LOGS, new RegExp(`^${name}-\\d{8}\\.log$`), 30, now)
      pruneFiles(join(LOGS, 'agent-runs'), /^(?!provider-health)/, 30, now)
      pruneFiles(join(LOGS, 'briefs'), /\.local\.md$/, 60, now)
    }
  }
}

const invokedDirectly = process.argv[1] != null && /(^|[\\/])workflow\.ts$/i.test(process.argv[1])
if (invokedDirectly) await main()
