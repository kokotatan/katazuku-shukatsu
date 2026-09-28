/**
 * 正本DBの短い読み口(読み取り専用)。Sparkの katazuku_* ツールと同じ答えをターミナルで返す。
 *
 *   npm run quick -- today            # 今日の予定 全件(締切含む)
 *   npm run quick -- next [N]         # いまから先の予定 N件(既定5)
 *   npm run quick -- conflicts [日数]  # 重なり検出(既定14日先まで)
 *   npm run quick -- status [語]      # 選考ステータス
 *
 * DBは data/katazuku.db(または $KATAZUKU_DB)。
 */
import { openDbReadOnly, quickRead, type QuickCommand } from '../src/quick-read.js'

const COMMANDS: QuickCommand[] = ['today', 'next', 'conflicts', 'status']
const cmd = (process.argv[2] ?? 'today') as QuickCommand
if (!COMMANDS.includes(cmd)) {
  console.log('使い方: npm run quick -- today | next [N] | conflicts [日数] | status [語]')
  process.exit(1)
}
const db = openDbReadOnly(process.env.KATAZUKU_DB ?? 'data/katazuku.db')
try {
  for (const l of quickRead(db, cmd, process.argv[3])) console.log(l)
} finally {
  db.close()
}
