import { validateJsonSchema } from './agent-runtime.js'
import { SPARK_KINDS } from './spark-handoff.js'
import { SparkQueue } from './spark-queue.js'
import type { QuickCommand } from './quick-read.js'

const string = { type: 'string', minLength: 1 }
const schema = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required })

/** Sparkが「shukatsu」を終活と取り違えたため、就職活動のツールであることを最初に明示する */
export const SPARK_INSTRUCTIONS = [
  'katazuku-shukatsu は本人一人の就職活動(就活・新卒採用の選考)を管理するツール。終活(人生の終わりの準備)とは無関係。',
  '面接・説明会・締切などの予定、応募企業ごとの選考状況は、Gmailやカレンダーを検索する前に katazuku_today / katazuku_next / katazuku_conflicts / katazuku_status で正本DBから読む。',
  '読み取りツールは結果を変更しない。メール送信・予約確定・DB書き込みの手段はない。',
  '企業研究・メール抽出・面談準備・文書や返信の草案を後で受け取りたいときは spark_enqueue で依頼し、spark_status / spark_list で結果を見る。',
].join('\n')

/** 読み取りツール名 → db-quick のコマンド */
export const SPARK_READ_TOOLS: Record<string, QuickCommand> = {
  katazuku_today: 'today', katazuku_next: 'next', katazuku_conflicts: 'conflicts', katazuku_status: 'status',
}
/** 正本DBの読み口。bridgeはMiniPCの正本を読み取り専用で開いて渡す。無い経路ではツールがエラーを返す */
export type SparkReader = (cmd: QuickCommand, arg?: string | number) => string[]

export const sparkTools = [
  { name: 'katazuku_today', annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, description: '就活: 今日の面接・説明会・締切などの予定を全件返す(開始-終了 | 種別 | 企業 | 題名 | 担当者 | 参加URL)。読み取り専用。',
    inputSchema: schema({}) },
  { name: 'katazuku_next', annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, description: '就活: 今から先の予定を近い順に返す。countは件数(既定5・最大30)。読み取り専用。',
    inputSchema: schema({ count: { type: 'integer', minimum: 1, maximum: 30 } }, []) },
  { name: 'katazuku_conflicts', annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, description: '就活: 時間が重なっている予定の組を返す。daysは何日先まで見るか(既定14・最大60)。締切と終日予定は除く。読み取り専用。',
    inputSchema: schema({ days: { type: 'integer', minimum: 1, maximum: 60 } }, []) },
  { name: 'katazuku_status', annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, description: '就活: 応募企業ごとの選考状況(企業 | 時期 | 職種 | ステータス)を返す。companyに社名の一部を渡すと絞り込む。読み取り専用。',
    inputSchema: schema({ company: { ...string, maxLength: 80 } }, []) },
  { name: 'spark_enqueue', annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, description: '就活の作業を依頼する(kind: research=企業研究 / daily-sync=メール本文からの抽出 / meeting-prep=面談準備 / document=文書草案 / reply-draft=返信案)。結果は草案として後で受け取る。送信・予約・シェル実行には使えない。同じ依頼キーは再送しない。',
    inputSchema: schema({ requestKey: { ...string, maxLength: 160 }, kind: { enum: [...SPARK_KINDS] }, input: { ...string, maxLength: 100_000 } }) },
  { name: 'spark_status', annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, description: 'spark_enqueueした就活作業の進行と、検証済み草案を取得。承認やDB反映を意味しない。', inputSchema: schema({ runId: string }) },
  { name: 'spark_list', annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, description: 'spark_enqueueした就活作業の直近50件の状態を取得。予定や選考状況はここには無い(katazuku_* を使う)。', inputSchema: schema({}) },
  { name: 'spark_claim', description: '待機中の依頼を一つ引き受ける。返されたpromptだけを作業し、10分以内にreportする。', inputSchema: schema({}) },
  { name: 'spark_report', description: 'claimした依頼の結果を返す。完成JSONは依頼hashとSchemaを検証して草案として受領する。',
    inputSchema: schema({ runId: string, lease: string, state: { enum: ['waiting', 'complete', 'blocked'] }, taskUrl: string, response: { ...string, maxLength: 1_000_000 }, reason: { ...string, maxLength: 500 } }, ['runId', 'lease', 'state']) },
]
/** アプリ一覧に出すアイコン。gatewayが同じホストで配信する(spark-gateway/worker.ts) */
export const sparkIcons = (origin: string) => [{ src: `${origin}/icon-192.png`, mimeType: 'image/png', sizes: ['192x192'] }]
/** transport非依存。全toolを固定リストで検証し、任意コマンドは受け付けない。 */
export function sparkRpc(queue: SparkQueue, input: unknown, reader?: SparkReader, iconOrigin?: string): unknown | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } }
  const message = input as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown }
  const id = typeof message.id === 'string' || typeof message.id === 'number' ? message.id : null
  const fail = (code: number, text: string) => ({ jsonrpc: '2.0', id, error: { code, message: text } })
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result })
  if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') return fail(-32600, 'Invalid Request')
  if (message.id === undefined) return undefined
  if (id === null) return fail(-32600, 'Invalid Request')
  if (message.method === 'initialize') return ok({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'katazuku-shukatsu', title: 'katazuku 就活管理', version: '1.2.0', ...(iconOrigin ? { icons: sparkIcons(iconOrigin) } : {}) }, instructions: SPARK_INSTRUCTIONS })
  if (message.method === 'ping') return ok({})
  if (message.method === 'tools/list') return ok({ tools: sparkTools })
  if (message.method !== 'tools/call') return fail(-32601, 'Method not found')
  const params = message.params as { name?: string; arguments?: Record<string, unknown> } | undefined
  const tool = sparkTools.find(t => t.name === params?.name)
  if (!tool) return fail(-32602, '未知のツールです')
  const args = params?.arguments ?? {}
  if (validateJsonSchema(args, tool.inputSchema).length) return fail(-32602, 'ツール引数が不正です')
  try {
    const read = SPARK_READ_TOOLS[tool.name]
    if (read) {
      if (!reader) throw new Error('この接続では就活DBを読めません(常駐PCのbridge経由でのみ利用可能)')
      const arg = read === 'next' ? args.count : read === 'conflicts' ? args.days : read === 'status' ? args.company : undefined
      return ok({ content: [{ type: 'text', text: reader(read, arg as string | number | undefined).join('\n') }], isError: false })
    }
    let result: unknown
    if (tool.name === 'spark_enqueue') result = queue.enqueue(args.requestKey as string, args.kind as string, args.input as string)
    else if (tool.name === 'spark_status') result = queue.status(args.runId as string)
    else if (tool.name === 'spark_list') result = queue.list()
    else if (tool.name === 'spark_claim') result = queue.claim()
    else result = queue.report(args.runId as string, args.lease as string, args as Parameters<SparkQueue['report']>[2])
    return ok({ content: [{ type: 'text', text: JSON.stringify(result) }], isError: false })
  } catch (error) {
    return ok({ content: [{ type: 'text', text: error instanceof Error ? error.message : '処理できませんでした' }], isError: true })
  }
}
