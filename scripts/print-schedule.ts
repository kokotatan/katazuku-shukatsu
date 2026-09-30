/**
 * 自動運転ワークフローの定期実行設定を、OSごとの書式で出力する(書き込みはしない。貼り付けは本人が行う)。
 *
 *   npm run schedule:print -- cron       # crontab -e に貼る行(macOS / Linux)
 *   npm run schedule:print -- launchd    # ~/Library/LaunchAgents に置く plist(macOS)
 *   npm run schedule:print -- systemd    # ~/.config/systemd/user に置く service / timer(Linux)
 *
 * Windows は scripts/register-tasks.ps1(タスクスケジューラ)を使う。
 * 時刻は既定値。設定で無効にしたワークフローは出力しない。
 */
import { join } from 'node:path'
import { repositoryRoot } from '../src/database-path.js'
import { loadConfig, type WorkflowName } from '../src/katazuku-config.js'

export interface ScheduleEntry {
  workflow: WorkflowName
  /** cron 形式(分 時 日 月 曜日) */
  cron: string
  /** 人に向けた説明 */
  label: string
}

/** 既定の時刻表。判断が要る処理と決定的な処理の時刻をずらし、同時に provider 枠を奪い合わないようにする */
export const DEFAULT_SCHEDULE: ScheduleEntry[] = [
  { workflow: 'mail-watch', cron: '15 7-22 * * *', label: 'メール見張り(7:15〜22:15 毎時)' },
  { workflow: 'daily-sync', cron: '23 8 * * *', label: '選考同期(毎朝 8:23)' },
  { workflow: 'asa', cron: '0 9 * * *', label: '朝のまとめ(毎朝 9:00)' },
  { workflow: 'calendar-sync', cron: '*/30 * * * *', label: 'カレンダー同期(30分ごと)' },
  { workflow: 'evening-brief', cron: '15 20 * * *', label: '前夜ブリーフ(毎晩 20:15)' },
  { workflow: 'watchdog', cron: '45 */4 * * *', label: '番犬(4時間ごと)' },
]

function command(root: string, workflow: string): string {
  return `cd ${JSON.stringify(root)} && ${JSON.stringify(process.execPath)} ${JSON.stringify(join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'))} scripts/workflow.ts ${workflow}`
}

export function cronLines(entries: ScheduleEntry[], root: string): string[] {
  return [
    '# katazuku 自動運転(npm run schedule:print -- cron の出力)',
    ...entries.map((entry) => `${entry.cron} ${command(root, entry.workflow)} >> ${JSON.stringify(join(root, 'logs', 'cron.log'))} 2>&1  # ${entry.label}`),
  ]
}

/** cron の「分 時」だけを launchd の StartCalendarInterval に写す(毎時・N分おきは展開する) */
function calendarIntervals(cron: string): { Hour?: number; Minute: number }[] {
  const [minute, hour] = cron.split(' ')
  const expand = (field: string, max: number): number[] | undefined => {
    if (field === '*') return undefined
    const step = field.match(/^\*\/(\d+)$/)
    if (step) return Array.from({ length: Math.ceil(max / Number(step[1])) }, (_, index) => index * Number(step[1]))
    const range = field.match(/^(\d+)-(\d+)$/)
    if (range) return Array.from({ length: Number(range[2]) - Number(range[1]) + 1 }, (_, index) => Number(range[1]) + index)
    return field.split(',').map(Number)
  }
  const minutes = expand(minute, 60) ?? [0]
  const hours = expand(hour, 24)
  return hours
    ? hours.flatMap((h) => minutes.map((m) => ({ Hour: h, Minute: m })))
    : minutes.map((m) => ({ Minute: m }))
}

export function launchdPlist(entry: ScheduleEntry, root: string): string {
  const intervals = calendarIntervals(entry.cron).map((interval) =>
    `      <dict>${interval.Hour !== undefined ? `<key>Hour</key><integer>${interval.Hour}</integer>` : ''}<key>Minute</key><integer>${interval.Minute}</integer></dict>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>local.katazuku.${entry.workflow}</string>
    <key>WorkingDirectory</key><string>${root}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${process.execPath}</string>
      <string>${join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs')}</string>
      <string>scripts/workflow.ts</string>
      <string>${entry.workflow}</string>
    </array>
    <key>StartCalendarInterval</key>
    <array>
${intervals}
    </array>
    <key>StandardOutPath</key><string>${join(root, 'logs', `launchd-${entry.workflow}.log`)}</string>
    <key>StandardErrorPath</key><string>${join(root, 'logs', `launchd-${entry.workflow}.log`)}</string>
  </dict>
</plist>`
}

function systemdOnCalendar(cron: string): string {
  const [minute, hour] = cron.split(' ')
  const toSystemd = (field: string) => field === '*' ? '*' : field.replace(/^\*\/(\d+)$/, '0/$1').replace(/^(\d+)-(\d+)$/, '$1..$2')
  return `*-*-* ${toSystemd(hour)}:${toSystemd(minute).padStart(2, '0')}:00`
}

export function systemdUnits(entry: ScheduleEntry, root: string): string {
  return `# ~/.config/systemd/user/katazuku-${entry.workflow}.service
[Unit]
Description=katazuku ${entry.label}

[Service]
Type=oneshot
WorkingDirectory=${root}
ExecStart=${process.execPath} ${join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs')} scripts/workflow.ts ${entry.workflow}

# ~/.config/systemd/user/katazuku-${entry.workflow}.timer
[Unit]
Description=katazuku ${entry.label}

[Timer]
OnCalendar=${systemdOnCalendar(entry.cron)}
Persistent=true

[Install]
WantedBy=timers.target
`
}

const invokedDirectly = process.argv[1] != null && /print-schedule\.ts$/i.test(process.argv[1])
if (invokedDirectly) {
  const root = repositoryRoot()
  const config = loadConfig(root)
  const entries = DEFAULT_SCHEDULE.filter((entry) => config.workflows[entry.workflow].enabled)
  const format = process.argv[2] ?? 'cron'
  if (format === 'cron') console.log(cronLines(entries, root).join('\n'))
  else if (format === 'launchd') for (const entry of entries) console.log(`<!-- ~/Library/LaunchAgents/local.katazuku.${entry.workflow}.plist -->\n${launchdPlist(entry, root)}\n`)
  else if (format === 'systemd') for (const entry of entries) console.log(systemdUnits(entry, root))
  else {
    console.error('使い方: npm run schedule:print -- cron | launchd | systemd')
    process.exit(1)
  }
}
