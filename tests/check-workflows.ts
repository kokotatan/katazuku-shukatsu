/**
 * 自動運転ワークフロー(mail-watch / daily-sync / asa / evening-brief / calendar-sync / watchdog)の
 * 決定論的な部品のチェック。インメモリSQLiteと一時ディレクトリだけで動き、ネットワーク・AIは呼ばない。
 * フィクスチャは架空の合成ラベル(A社〜F社・example.com)だけを使う。
 *   npm run test:workflows
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addAppointment, openDb, SCHEMA_VERSION } from '../src/db.js'
import { applyDiff } from '../src/db-apply.js'
import { applyCalendar } from '../src/db-apply-calendar.js'
import { applyMail } from '../src/db-apply-mail.js'
import { applySubmission } from '../src/db-apply-submission.js'
import { applyDailySyncResult, buildExtractionBatches, mergeExtractionResults, parseModelJson, validateDailySyncResult } from '../src/daily-sync.js'
import { inputDigest, validateCoverage, type MailInput } from '../src/daily-sync-input.js'
import { applySubmissionRequirements, completeMatchingRequirement, listSubmissionRequirements } from '../src/submission-requirement.js'
import { evaluateSubmissionReadiness } from '../src/submission-readiness.js'
import { getScheduleAvailability } from '../src/schedule.js'
import { normalizeProviderName, providerOrderFor, renderTemplate, resolveConfig, templateVars } from '../src/katazuku-config.js'
import { acquireLock, appendActivity, hasSentinel, recordAlert, runIdFor } from '../src/workflow-support.js'
import { classifyFailure, createClaudeAdapter, createCodexAdapter, runAgent, type ProcessResult } from '../src/agent-runtime.js'
import { normalizeCalendarEvents, utcOffsetFor } from '../scripts/calendar-fetch.js'
import { dayRange, getBriefData } from '../scripts/brief-data.js'
import { stripHtml, buildQuery } from '../scripts/gmail-fetch.js'
import { cronLines, DEFAULT_SCHEDULE } from '../scripts/print-schedule.js'
import { checkWatchdog } from '../scripts/workflow.js'

let failed = 0
function check(label: string, cond: boolean, detail = '') {
  console.log(`${cond ? '[ok]' : '[FAIL]'} ${label}${cond ? '' : ` — ${detail}`}`)
  if (!cond) failed++
}
function throws(fn: () => unknown): boolean {
  try { fn(); return false } catch { return true }
}

// ---- スキーマ v4 ----
{
  const db = openDb(':memory:')
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((row) => row.name)
  check('v4: 提出物台帳・予定投影・取得状態の表がある', ['submission_requirement', 'schedule_block', 'source_sync_state'].every((name) => tables.includes(name)))
  check('v4: appointment.flexible 列がある', (db.prepare('PRAGMA table_info(appointment)').all() as { name: string }[]).some((col) => col.name === 'flexible'))
  check('SCHEMA_VERSION は 4', SCHEMA_VERSION === 4)
}

// ---- 提出物台帳 ----
{
  const db = openDb(':memory:')
  applyDiff(db, [{ name: 'A社', stage: 'intern', position: '夏インターン' }])
  const req = { sourceRef: 'msg-1', company: 'A社', position: '夏インターン', kind: 'pledge', title: '誓約書', deadline: '2030-01-10', status: 'required' as const }
  const first = applySubmissionRequirements(db, [req, { ...req, kind: 'insurance_certificate', title: '保険加入証明書' }])
  check('提出物: 成果物1件ずつ台帳化される', first.created === 2)
  const again = applySubmissionRequirements(db, [{ ...req, sourceRef: 'msg-2' }])
  check('提出物: 同じ成果物の再取得は更新(重複しない)', again.created === 0 && again.updated === 1)
  applySubmissionRequirements(db, [{ ...req, sourceRef: 'msg-3', status: 'completed' }])
  applySubmissionRequirements(db, [{ ...req, sourceRef: 'msg-4', status: 'required' }])
  const pledge = listSubmissionRequirements(db).find((row) => row.kind === 'pledge')!
  check('提出物: 古い依頼メールの再取得で完了を未完了へ巻き戻さない', pledge.status === 'completed')
  const open = evaluateSubmissionReadiness(db, new Date('2030-01-09T12:00:00+09:00'))
  check('提出物: 未完了だけが再評価され、48時間以内は urgent', open.length === 1 && open[0].severity === 'urgent')
  const selectionId = (db.prepare('SELECT id FROM selection').get() as { id: number }).id
  applySubmissionRequirements(db, [{ ...req, sourceRef: 'msg-5', kind: 'self_intro', title: '自己紹介スライド(前半)' }, { ...req, sourceRef: 'msg-6', kind: 'self_intro', title: '自己紹介スライド(後半)' }])
  check('提出物: 同種が複数あるときは種別だけの提出根拠でまとめて完了にしない', completeMatchingRequirement(db, selectionId, 'self_intro', 'msg-7') === 0)
  const submitted = applySubmission(db, { sourceRef: 'msg-8', company: 'A社', position: '夏インターン', kind: 'insurance_certificate', submittedAt: '2030-01-08T10:00:00+09:00' })
  check('提出結果: 一意に特定できる未完了の提出物は提出根拠で閉じる', submitted.created && listSubmissionRequirements(db, { openOnly: true }).every((row) => row.kind !== 'insurance_certificate'))
  check('提出結果: 同じ根拠の再反映は重複しない', applySubmission(db, { sourceRef: 'msg-8', company: 'A社', position: '夏インターン', kind: 'insurance_certificate', submittedAt: '2030-01-08T10:00:00+09:00' }).created === false)
}

// ---- メール要約(Inbox) ----
{
  const db = openDb(':memory:')
  const items = [{ id: 'm1', receivedAt: '2030-01-01T00:00:00Z', subject: '説明会のご案内', company: 'B社' }]
  check('メール: 初回は追加', applyMail(db, { items }).created === 1)
  check('メール: 同じIDは更新(冪等)', applyMail(db, { items }).updated === 1)
  check('メール: 募集案内の保存だけで応募トラックを作らない', (db.prepare('SELECT COUNT(*) AS n FROM selection').get() as { n: number }).n === 0)
}

// ---- 日次同期: 抽出の検証・網羅性・反映 ----
{
  const input: MailInput = {
    accounts: [{ status: 'success' }],
    messages: [
      { id: 'x1', receivedAt: '2030-01-01T00:00:00Z', subject: '一次面接のご案内', body: '...' },
      { id: 'x2', receivedAt: '2030-01-01T01:00:00Z', subject: 'ニュースレター', body: '...' },
    ],
  }
  const batches = buildExtractionBatches(input, '抽出してください', '{}')
  check('抽出: 本文をプロンプトへ埋め込み、入力ダイジェストを指示する', batches.length === 1 && batches[0].prompt.includes(inputDigest(input)) && batches[0].prompt.includes('MAIL_DATA'))
  const output = {
    schemaVersion: 1,
    selections: [{ name: 'C社', stage: 'interview', position: '本選考', appointments: [{ at: '2030-01-05T10:00:00+09:00', kind: '面接', title: '一次面接' }] }],
    mailItems: [{ id: 'x1', receivedAt: '2030-01-01T00:00:00Z', subject: '一次面接のご案内', company: 'C社', needsAction: true }],
    submissions: [],
    requirements: [],
    coverage: { status: 'completed', inputDigest: inputDigest(input), reviewedMessageIds: ['x1', 'x2'] },
  }
  check('抽出: Schema に一致する結果は通る', !throws(() => validateDailySyncResult(output)))
  check('抽出: 未知の項目があれば全体を拒否', throws(() => validateDailySyncResult({ ...output, extra: 1 })))
  check('抽出: 読んでいないメールがあれば網羅性で拒否', throws(() => validateCoverage(input, { ...output.coverage, status: 'completed', reviewedMessageIds: ['x1'] })))
  const merged = mergeExtractionResults(input, [{ input: batches[0].input, output }])
  const db = openDb(':memory:')
  const summary = applyDailySyncResult(db, merged)
  check('反映: 選考と予定とメールが正本へ入る', summary.selections.added.length === 1 && summary.mail.created === 1
    && (db.prepare('SELECT COUNT(*) AS n FROM appointment').get() as { n: number }).n === 1)
  check('反映: 暴走ブレーキ(上限超えは --force なしで中止)', throws(() => applyDailySyncResult(openDb(':memory:'), { ...merged, selections: Array.from({ length: 16 }, (_, i) => ({ name: `D社${i}`, stage: 'entried' as const })) })))
  check('出力: コードフェンス付きでもJSONを取り出す', (parseModelJson('```json\n{"a":1}\n```') as { a: number }).a === 1)
}

// ---- 空き判定(情報不足を空きと誤認しない) ----
{
  const db = openDb(':memory:')
  const now = new Date('2030-02-01T00:00:00Z')
  const noSync = getScheduleAvailability(db, '2030-02-02T01:00:00Z', '2030-02-02T02:00:00Z', { now, databaseRole: 'canonical' })
  check('空き判定: カレンダー同期の実績が無ければ unknown', noSync.state === 'unknown')
  applyCalendar({
    events: [],
    scheduleBlocks: [{ externalId: 'ev1', accountId: 'you@example.com', startAt: '2030-02-02T01:30:00Z', endAt: '2030-02-02T02:30:00Z', title: '授業' }],
    syncStates: [{ source: 'google-calendar', accountId: 'you@example.com', status: 'success', coveredFrom: '2030-01-25T00:00:00Z', coveredUntil: '2030-03-01T00:00:00Z', attemptedAt: now.toISOString() }],
  }, db)
  check('空き判定: 私用・授業の予定とも重なれば conflict', getScheduleAvailability(db, '2030-02-02T01:00:00Z', '2030-02-02T02:00:00Z', { now, databaseRole: 'canonical' }).state === 'conflict')
  check('空き判定: 同期が新しく重ならなければ available', getScheduleAvailability(db, '2030-02-02T05:00:00Z', '2030-02-02T06:00:00Z', { now, databaseRole: 'canonical' }).state === 'available')
  check('空き判定: 同期が古ければ unknown', getScheduleAvailability(db, '2030-02-02T05:00:00Z', '2030-02-02T06:00:00Z', { now: new Date('2030-02-01T03:00:00Z'), databaseRole: 'canonical' }).state === 'unknown')
  check('空き判定: 正本でないDBでは unknown', getScheduleAvailability(db, '2030-02-02T05:00:00Z', '2030-02-02T06:00:00Z', { now, databaseRole: 'replica' }).state === 'unknown')
}

// ---- カレンダーの正規化(LLMなし) ----
{
  const companies = [{ needle: 'サンプル商事', name: '株式会社サンプル商事' }, { needle: 'E社', name: 'E社' }]
  const normalized = normalizeCalendarEvents([
    { id: 'c1', summary: 'サンプル商事 一次面接', start: { dateTime: '2030-03-01T10:00:00+09:00' }, end: { dateTime: '2030-03-01T11:00:00+09:00' }, location: 'https://meet.google.com/abc-defg-hij', calendarId: 'a', accountId: 'you@example.com' },
    { id: 'c2', summary: 'サンプル商事 一次面接', start: { dateTime: '2030-03-01T10:00:00+09:00' }, calendarId: 'b', accountId: 'you@example.com' },
    { id: 'c3', summary: '略称だけの面接', start: { dateTime: '2030-03-02T10:00:00+09:00' } },
    { id: 'c4', summary: 'E社 説明会', start: { dateTime: '2030-03-03T10:00:00+09:00' } },
    { id: 'c5', summary: 'ゼミ', start: { date: '2030-03-04' }, end: { date: '2030-03-05' } },
    { id: 'c6', summary: 'サンプル商事 最終面接', status: 'cancelled', start: { dateTime: '2030-03-06T10:00:00+09:00' } },
  ], { companies, multiTrack: new Set(['E社']), knownPositions: new Map(), ownAccounts: ['you@example.com'] })
  check('カレンダー: 予定名から企業を特定し、会議URLを拾う', normalized.events.some((event) => event.company === '株式会社サンプル商事' && String(event.url).includes('meet.google.com')))
  check('カレンダー: 複数カレンダーの同じ予定は1件に', normalized.duplicates === 1)
  check('カレンダー: 企業を特定できない選考予定は要判定へ', normalized.residue.some((event) => event.externalId === 'c3' && !event.company))
  check('カレンダー: 複数トラック企業は position 判定のため要判定へ', normalized.residue.some((event) => event.externalId === 'c4' && event.needsPosition === true))
  check('カレンダー: 私用・終日も空き判定用の投影には残す', normalized.scheduleBlocks.some((block) => block.externalId === 'c5' && block.allDay === true))
  check('カレンダー: 中止は「中止」で持ち帰り、占有させない', normalized.events.some((event) => event.externalId === 'c6' && event.status === '中止')
    && normalized.scheduleBlocks.some((block) => block.externalId === 'c6' && block.busy === false))
  check('カレンダー: タイムゾーンのオフセット', utcOffsetFor('Asia/Tokyo') === '+09:00')
}

// ---- 前夜ブリーフのデータ(UTC保存でも日本時間の朝の予定を落とさない) ----
{
  const db = openDb(':memory:')
  applyDiff(db, [{ name: 'F社', stage: 'interview', position: '本選考' }])
  const selectionId = (db.prepare('SELECT id FROM selection').get() as { id: number }).id
  addAppointment(db, { selectionId, at: '2030-04-02T08:30:00+09:00', kind: '面接', title: '二次面接' })
  const range = dayRange('2030-04-02', '+09:00')
  check('ブリーフ: ローカル日付の範囲をUTCへ直す', range.from === '2030-04-01T15:00:00.000Z')
  check('ブリーフ: 日本時間の朝の予定が前日扱いにならない', getBriefData(db, '2030-04-02', '+09:00').count === 1 && getBriefData(db, '2030-04-01', '+09:00').count === 0)
}

// ---- 設定とプロンプトの差し込み ----
{
  const config = resolveConfig({
    profile: { displayName: '就活 太郎', signature: ['就活 太郎', 'Mail: you@example.com'] },
    google: { accounts: [{ id: 'main', email: 'you@example.com', primary: true }, { id: 'school', email: 'student@example.com' }] },
    agent: { providerOrder: ['claude-cli', 'codex-cli', 'codex-oss'], localModelWorkflows: ['asa'] },
  })
  check('設定: 表示用の provider 名を実行契約のIDへ寄せる', config.agent.providerOrder.join(',') === 'claude,codex,codex-oss' && normalizeProviderName('codex-cli') === 'codex')
  check('設定: ローカルモデルは許可したワークフローだけ', providerOrderFor(config, 'daily-sync', {}).join(',') === 'claude,codex' && providerOrderFor(config, 'asa', {}).includes('codex-oss'))
  check('設定: 環境変数で順番を上書きできる', providerOrderFor(config, 'asa', { KATAZUKU_AGENT_ORDER: 'codex-cli' }).join(',') === 'codex')
  check('設定: 主アカウント以外は既定で主カレンダーだけ', config.google.accounts[1].calendars === 'primary')
  check('設定: 主アカウントが2つなら拒否', throws(() => resolveConfig({ google: { accounts: [{ id: 'a', email: 'a@example.com', primary: true }, { id: 'b', email: 'b@example.com', primary: true }] } })))
  check('設定: 未知の項目は拒否', throws(() => resolveConfig({ unknownKey: true })))
  check('設定: 設定ファイルが無くても既定値で動く(inbox-tidy は既定で無効)', resolveConfig({}).workflows['inbox-tidy'].enabled === false)
  const vars = templateVars(config, new Date('2030-05-01T00:00:00Z'))
  check('差し込み: 署名・アカウント一覧は設定由来', vars.SIGNATURE.includes('就活 太郎') && vars.ACCOUNT_LIST.includes('student@example.com') && vars.TODAY.startsWith('2030-05-01'))
  check('差し込み: 未定義の差し込みは空欄で渡さず止める', throws(() => renderTemplate('{{UNKNOWN}}', vars)))
  check('Gmail検索: 期間と就活語彙を組み立てる', buildQuery(config, { days: 3 }).startsWith('newer_than:3d {'))
  check('Gmail本文: HTMLをテキストにする', stripHtml('<p>A&amp;B</p><br>次行') === 'A&B\n\n次行' || stripHtml('<p>A&amp;B</p><br>次行').includes('A&B'))
}

// ---- 完了行・ロック・番犬 ----
{
  check('完了行: 単独行の完了行だけを認める', hasSentinel('要約\n=== asa DONE ===\n', 'asa') && !hasSentinel('「=== asa DONE ===」と出力する', 'asa'))
  check('runId: 分単位・日単位', runIdFor('mail-watch', new Date('2030-01-01T09:07:00Z')) === 'mail-watch:20300101T0907' && runIdFor('asa', new Date('2030-01-01T09:07:00Z'), 'day') === 'asa:20300101')
  const root = mkdtempSync(join(tmpdir(), 'katazuku-workflow-'))
  try {
    const release = acquireLock('mail-watch', 60_000, root)
    check('ロック: 実行中の二重起動を防ぐ', Boolean(release) && acquireLock('mail-watch', 60_000, root) === undefined)
    release?.()
    check('ロック: 解放後は取れる', Boolean(acquireLock('mail-watch', 60_000, root)))
    const config = resolveConfig({ agent: { providerOrder: ['claude'] } })
    const now = new Date('2030-06-01T12:00:00Z')
    appendActivity({ by: 'mail-watch', action: 'x', why: 'y' }, root, new Date('2030-06-01T11:00:00Z'))
    appendActivity({ by: 'daily-sync', action: 'x', why: 'y' }, root, new Date('2030-05-28T00:00:00Z'))
    recordAlert('asa', '完了行がない', undefined, root, now)
    mkdirSync(join(root, 'logs', 'agent-runs'), { recursive: true })
    writeFileSync(join(root, 'logs', 'agent-runs', 'provider-health.local.json'), JSON.stringify({ schemaVersion: 1, providers: { claude: { failure: 'quota_exhausted', unavailableUntil: '2030-06-02T00:00:00Z' } } }))
    const report = checkWatchdog(config, now, root)
    check('番犬: 止まったジョブを見つける', report.keys.includes('stale:daily-sync') && !report.keys.some((key) => key.endsWith(':mail-watch')))
    check('番犬: 各ジョブの alert を拾う', report.keys.includes('alert:asa'))
    check('番犬: provider がすべて利用枠切れなら知らせる', report.keys.includes('providers-exhausted'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  check('スケジュール: cron 行を出力できる', cronLines(DEFAULT_SCHEDULE, '/repo').length === DEFAULT_SCHEDULE.length + 1)
}

// ---- agent-runtime の改善点 ----
{
  const base: ProcessResult = { exitCode: 1, signal: null, stdout: '', stderr: '', timedOut: false, durationMs: 1 }
  const toolOutput = JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', aggregated_output: 'README: weekly limit について' } })
  check('利用枠: ツール出力に文言があるだけでは枠切れと誤判定しない', classifyFailure({ ...base, stdout: toolOutput }) !== 'quota_exhausted')
  check('利用枠: provider 自身のエラーイベントは枠切れと判定する', classifyFailure({ ...base, stdout: JSON.stringify({ type: 'error', message: "You've hit your weekly limit" }) }) === 'quota_exhausted')
  const claude = createClaudeAdapter({ command: 'claude' })
  const request = { runId: 'r', workflowId: 'w', prompt: 'p', cwd: '.', capabilities: ['gmail.read'], risk: 'read-only' as const, sideEffectMode: 'none' as const, outputSchemaPath: 'schema.json' }
  const invocation = claude.buildInvocation(request, { finalOutputPath: 'out.txt' })
  check('Claude: claude.ai 側のコネクタを読み込まない', invocation.env?.ENABLE_CLAUDEAI_MCP_SERVERS === 'false')
  check('Claude: プロンプトは stdin で渡す(引数に入れない)', invocation.stdin === 'p' && !invocation.args.includes('p'))
  const codex = createCodexAdapter({ command: 'codex' }).buildInvocation(request, { finalOutputPath: 'out.txt' })
  check('Codex: 任意項目のある schema を native structured output へ渡さない', !codex.args.includes('--output-schema'))
  const root = mkdtempSync(join(tmpdir(), 'katazuku-runtime-'))
  try {
    const healthFile = join(root, 'health.json')
    await runAgent({ ...request, capabilities: [], providerOrder: ['codex'] }, {
      adapters: [{
        ...createCodexAdapter({ command: 'codex' }),
        preflight: async () => ({ ok: true }),
      }],
      artifactDir: root,
      healthFile,
      now: () => new Date('2030-07-01T00:00:00Z'),
      execute: async () => ({ ...base, stderr: "You've hit your weekly limit · resets Jun 30, 9pm (UTC)" }),
    })
    const { readFileSync } = await import('node:fs')
    const until = Date.parse(JSON.parse(readFileSync(healthFile, 'utf8')).providers.codex.unavailableUntil)
    check('利用枠: 復活予定の読み違いでも休止は最長7日', until <= Date.parse('2030-07-08T00:00:00Z'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

if (failed) { console.error(`\n${failed}件失敗`); process.exit(1) }
console.log('\nすべて通過')
