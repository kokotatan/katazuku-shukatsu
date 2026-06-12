/**
 * Inbox→Pipeline連携(lib/pipeline.ts)の動作チェック。
 * 実行: cd inbox && npx tsx scripts/check-pipeline.ts
 */
import type { Email } from '../src/types'

// Node には localStorage がないのでメモリ実装を差し込む
const store = new Map<string, string>()
;(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
}

const { addEmailToPipeline } = await import('../src/lib/pipeline')

const KEY = 'katazuku-pipeline/companies'

function email(p: Partial<Email>): Email {
  return {
    id: 'e1',
    from: '採用担当',
    fromAddress: 'hr@example.com',
    company: 'テスト株式会社',
    subject: 'テスト件名',
    body: '',
    receivedAt: new Date().toISOString(),
    category: 'task',
    deadline: null,
    deadlineKind: null,
    needsAction: true,
    actionHint: null,
    status: 'inbox',
    snoozeUntil: null,
    doneAt: null,
    source: 'demo',
    ...p,
  }
}

function companies(): { name: string; stage: string; nextAction: string; nextDate: string | null }[] {
  return JSON.parse(store.get(KEY) ?? '[]')
}

let failed = 0
function check(label: string, cond: boolean) {
  console.log(`${cond ? '✅' : '❌'} ${label}`)
  if (!cond) failed++
}

// 1. 空の状態から新規追加
let r = addEmailToPipeline(
  email({ company: '株式会社サンプル', category: 'task', deadline: '2026-06-20T12:00:00.000Z', actionHint: '6/20までにES提出' }),
)
check('新規追加: created=true', r.created)
check('新規追加: stage=task / nextDate抽出', companies()[0].stage === 'task' && companies()[0].nextDate === '2026-06-20')

// 2. 表記ゆれ(「株式会社」抜き)でも同一企業として更新
r = addEmailToPipeline(
  email({ company: 'サンプル', category: 'interview', deadline: '2026-06-25T10:00:00.000Z', actionHint: '面接日程を回答' }),
)
check('表記ゆれ更新: created=false', !r.created)
check('ステージ前進: task→interview', companies().length === 1 && companies()[0].stage === 'interview')
check('nextAction上書き', companies()[0].nextAction === '面接日程を回答')

// 3. ステージは後退しない(interview中にevent系メールが来ても scouted に戻らない)
addEmailToPipeline(email({ company: '株式会社サンプル', category: 'event', deadline: null, actionHint: '説明会に申し込み' }))
check('ステージ後退しない: interviewのまま', companies()[0].stage === 'interview')
check('期限なしメールでは既存nextDateを保持', companies()[0].nextDate === '2026-06-25')

// 4. 内定・終了ステージは自動連携で動かさない
store.set(KEY, JSON.stringify([{ id: 'x', name: '内定社', role: '', stage: 'offer', nextAction: '', nextDate: null, memo: '', updatedAt: '' }]))
addEmailToPipeline(email({ company: '内定社', category: 'interview' }))
check('offerステージは維持', companies()[0].stage === 'offer')

// 5. 別企業は別カードになる
addEmailToPipeline(email({ company: '株式会社べつの会社', category: 'event' }))
check('別企業は新規カード', companies().length === 2 && companies()[1].stage === 'scouted')

if (failed) {
  console.error(`\n${failed}件失敗`)
  process.exit(1)
}
console.log('\nすべて通過 🎉')
