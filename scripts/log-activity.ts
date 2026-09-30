/**
 * 自律処理が「何を・何のために・どうしたか」を logs/activity-log.jsonl に1行残す共通の入口。
 *   npx tsx scripts/log-activity.ts --by <ワークフロー名> --action "何を" --why "何のために" [--how "どうした"] [--link "確認先"] [--result 成功]
 * 追記だけなので競合・破損に強い。番犬(watchdog)は by 別の最終実行時刻をここから読む。
 */
import { appendActivity } from '../src/workflow-support.js'

const args = process.argv.slice(2)
const value = (name: string): string => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] ?? '' : ''
}
if (!value('--action') || !value('--why')) {
  console.error('使い方: log-activity.ts --by <名前> --action "何を" --why "何のために" [--how ...] [--link ...] [--result ...]')
  process.exit(1)
}
appendActivity({
  by: value('--by') || 'session',
  action: value('--action'),
  why: value('--why'),
  how: value('--how'),
  link: value('--link'),
  result: value('--result'),
})
console.log(`logged [${value('--by') || 'session'}] ${value('--action')}`)
