import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, join } from 'node:path'
import { SparkQueue } from '../src/spark-queue.js'
import { createDefaultAdapters, runAgent } from '../src/agent-runtime.js'

const repo = fileURLToPath(new URL('../', import.meta.url))
const queue = new SparkQueue(resolve(repo, 'logs/spark-queue.local.db'))
try {
  const configPath = resolve(repo, 'logs/spark-worker.local.json')
  let config: { enabled?: boolean; account?: string }
  try { config = JSON.parse(readFileSync(configPath, 'utf8')) } catch { config = {} }
  if (config.enabled !== true || !config.account) {
    console.log(JSON.stringify({ state: 'not_configured', pending: queue.list().filter(x => x.state === 'queued').length }))
  } else {
    const claim = queue.claim()
    if (!claim) console.log(JSON.stringify({ state: 'idle' }))
    else {
      const artifacts = join(repo, 'logs/spark-driver')
      mkdirSync(artifacts, { recursive: true })
      const schemaPath = join(artifacts, 'driver.schema.json')
      writeFileSync(schemaPath, JSON.stringify({ type: 'object', additionalProperties: false, required: ['state'], properties: {
        state: { enum: ['waiting', 'complete', 'blocked'] }, taskUrl: { type: 'string' }, response: { type: 'string' }, reason: { type: 'string' },
      } }))
      try {
        const adapters = await createDefaultAdapters(process.env, repo)
        const chrome = adapters.find(adapter => adapter.id === 'claude')!
        const invoke = chrome.buildInvocation.bind(chrome)
        chrome.buildInvocation = (request, paths) => {
          const invocation = invoke(request, paths)
          invocation.args.push('--chrome', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--tools', '')
          return invocation
        }
        const result = await runAgent({
          runId: 'spark-driver:' + claim.runId + ':' + claim.lease, workflowId: 'spark-browser-transport', cwd: repo,
          capabilities: ['browser.interact'], risk: 'external-draft', sideEffectMode: 'direct',
          providerOrder: ['claude'], outputSchemaPath: schemaPath, timeoutMs: 180_000,
          prompt: `Sparkのブラウザ受け渡しだけを行う。作業自体を自分で代行して回答を作らない。
本人の認証済みアカウント ${config.account} を画面で確認する。アカウント不一致、ログイン/MFA/同意/権限追加が必要ならblocked。認証操作をしない。
接続済みChromeだけを使う。拡張未接続ならblocked。既存のユーザー作業を中断しない。
operation=${claim.operation}; taskUrl=${claim.taskUrl || 'なし'}
dispatchの場合: Sparkの履歴にrunId=${claim.runId}のタスクが既にあれば再利用。確認できなければ新規タスクへ下記依頼を1度だけ送信。送信の成否が不明なら再送せずblocked。
pollの場合: 指定taskUrlだけを開いて確認。再送や新規タスク作成をしない。
結果が完成していれば画面上の回答全文をresponse文字列へ、そのまま返す。自分で補正・補完しない。
処理中ならwaitingと正確なtaskUrlを返して終了。長時間待機・反復取得しない。認証情報を結果に含めない。
出力は{state:'waiting'|'complete'|'blocked',taskUrl?:string,response?:string,reason?:string}のJSON。
Sparkへ送る依頼:\n${claim.prompt}`,
        }, { adapters, artifactDir: artifacts, healthFile: join(artifacts, 'provider-health.local.json') })
        if (result.status !== 'succeeded' || !result.output) queue.report(claim.runId, claim.lease, { state: 'blocked', reason: 'browser driver: ' + (result.failure || result.status) })
        else queue.report(claim.runId, claim.lease, JSON.parse(result.output))
      } catch {
        // 送信済みか判断できない例外を新規送信へ戻さない。
        try { queue.report(claim.runId, claim.lease, { state: 'blocked', reason: 'ブラウザ受け渡し失敗。送信履歴と成果物を確認してください' }) } catch { /* リース回復時に照合待ちにする */ }
      }
      const status = queue.status(claim.runId)
      console.log(JSON.stringify({ runId: status.runId, state: status.state, reason: status.reason }))
    }
  }
} finally { queue.close() }
