import { validateJsonSchema } from './agent-runtime.js'
import { SPARK_KINDS } from './spark-handoff.js'
import { SparkQueue } from './spark-queue.js'

const string = { type: 'string', minLength: 1 }
const schema = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required })
export const sparkTools = [
  { name: 'spark_enqueue', description: '調査・抽出・文書草案を依頼。送信・予約・シェル実行には使えない。同じ依頼キーは再送しない。',
    inputSchema: schema({ requestKey: { ...string, maxLength: 160 }, kind: { enum: [...SPARK_KINDS] }, input: { ...string, maxLength: 100_000 } }) },
  { name: 'spark_status', description: '依頼の進行・検証済み草案を取得。承認やDB反映を意味しない。', inputSchema: schema({ runId: string }) },
  { name: 'spark_list', description: '直近50件の依頼状態を取得。', inputSchema: schema({}) },
  { name: 'spark_claim', description: '待機中の依頼を一つ引き受ける。返されたpromptだけを作業し、10分以内にreportする。', inputSchema: schema({}) },
  { name: 'spark_report', description: 'claimした依頼の結果を返す。完成JSONは依頼hashとSchemaを検証して草案として受領する。',
    inputSchema: schema({ runId: string, lease: string, state: { enum: ['waiting', 'complete', 'blocked'] }, taskUrl: string, response: { ...string, maxLength: 1_000_000 }, reason: { ...string, maxLength: 500 } }, ['runId', 'lease', 'state']) },
]
/** transport非依存。全toolを固定リストで検証し、任意コマンドは受け付けない。 */
export function sparkRpc(queue: SparkQueue, input: unknown): unknown | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } }
  const message = input as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown }
  const id = typeof message.id === 'string' || typeof message.id === 'number' ? message.id : null
  const fail = (code: number, text: string) => ({ jsonrpc: '2.0', id, error: { code, message: text } })
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result })
  if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') return fail(-32600, 'Invalid Request')
  if (message.id === undefined) return undefined
  if (id === null) return fail(-32600, 'Invalid Request')
  if (message.method === 'initialize') return ok({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'katazuku-spark', version: '1.0.0' } })
  if (message.method === 'ping') return ok({})
  if (message.method === 'tools/list') return ok({ tools: sparkTools })
  if (message.method !== 'tools/call') return fail(-32601, 'Method not found')
  const params = message.params as { name?: string; arguments?: Record<string, unknown> } | undefined
  const tool = sparkTools.find(t => t.name === params?.name)
  if (!tool) return fail(-32602, '未知のツールです')
  const args = params?.arguments ?? {}
  if (validateJsonSchema(args, tool.inputSchema).length) return fail(-32602, 'ツール引数が不正です')
  try {
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
