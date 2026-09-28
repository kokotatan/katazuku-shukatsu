import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createSparkJob, sparkPrompt, validateSparkResponse, type SparkJob } from './spark-handoff.js'

export type SparkState = 'queued' | 'dispatching' | 'awaiting' | 'polling' | 'needs_review' | 'blocked' | 'expired'
export interface SparkQueueRow {
  id: string; request_key: string; job: string; state: SparkState; task_url: string | null
  lease: string | null; lease_until: number; next_poll: number; attempts: number
  result: string | null; reason: string | null
}
export function validSparkTaskUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.origin === 'https://gemini.google.com' && !url.username && !url.password && !url.search && !url.hash
      && /^\/(?:u\/\d+\/)?spark\/chat\/[a-zA-Z0-9_-]+$/.test(url.pathname)
  } catch { return false }
}
/** 正本と分離した実行台帳。SQL/シェル/外部確定操作は保持・実行しない。 */
export class SparkQueue {
  readonly db: DatabaseSync
  constructor(path: string, readonly clock: () => number = Date.now) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec(`PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS spark_job (
      id TEXT PRIMARY KEY, request_key TEXT UNIQUE NOT NULL, job TEXT NOT NULL,
      state TEXT NOT NULL, task_url TEXT, lease TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
      next_poll INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
      result TEXT, reason TEXT
    )`)
  }
  close() { this.db.close() }
  enqueue(key: string, kind: string, input: string) {
    if (!/^[a-zA-Z0-9:_-]{1,160}$/.test(key)) throw new Error('依頼キーが不正です')
    const job = createSparkJob(kind, input, new Date(this.clock()))
    this.db.prepare('INSERT OR IGNORE INTO spark_job(id,request_key,job,state) VALUES(?,?,?,?)').run(job.runId, key, JSON.stringify(job), 'queued')
    const row = this.db.prepare('SELECT * FROM spark_job WHERE request_key=?').get(key) as unknown as SparkQueueRow
    const existing = JSON.parse(row.job) as SparkJob
    if (existing.kind !== kind || existing.input !== input) throw new Error('同じ依頼キーで内容を変更できません')
    return this.status(row.id)
  }
  get(id: string): SparkQueueRow {
    const row = this.db.prepare('SELECT * FROM spark_job WHERE id=?').get(id) as unknown as SparkQueueRow | undefined
    if (!row) throw new Error('依頼がありません')
    return row
  }
  status(id: string) {
    this.recover()
    const row = this.get(id), job = JSON.parse(row.job) as SparkJob
    return { runId: id, kind: job.kind, state: row.state, taskUrl: row.task_url, attempts: row.attempts,
      reason: row.reason, expiresAt: job.expiresAt, result: row.result ? JSON.parse(row.result) as unknown : null }
  }
  list() {
    this.recover()
    return (this.db.prepare('SELECT id FROM spark_job ORDER BY rowid DESC LIMIT 50').all() as { id: string }[]).map(({ id }) => this.status(id))
  }
  recover() {
    const now = this.clock()
    // 送信中のクラッシュは成否不明。自動再送しない。取得中なら同じURLの読取を再開できる。
    this.db.prepare("UPDATE spark_job SET state='blocked',reason='送信の成否不明。Sparkの履歴と照合してURLを登録してください',lease=NULL WHERE state='dispatching' AND lease_until<=?").run(now)
    this.db.prepare("UPDATE spark_job SET state='awaiting',lease=NULL WHERE state='polling' AND lease_until<=?").run(now)
    for (const row of this.db.prepare("SELECT id,job FROM spark_job WHERE state IN ('queued','awaiting','blocked')").all() as { id: string; job: string }[]) {
      if (Date.parse((JSON.parse(row.job) as SparkJob).expiresAt) < now) this.db.prepare("UPDATE spark_job SET state='expired',reason='依頼期限切れ' WHERE id=?").run(row.id)
    }
  }
  claim() {
    this.recover()
    const now = this.clock(), lease = randomUUID()
    // UPDATE RETURNINGを1文で使い、同時worker/MCPからの二重claimを防ぐ。
    const row = this.db.prepare(`UPDATE spark_job SET
      state=CASE WHEN state='queued' THEN 'dispatching' ELSE 'polling' END,
      lease=?,lease_until=?,attempts=attempts+1
      WHERE id=(SELECT id FROM spark_job WHERE state IN ('queued','awaiting') AND next_poll<=? AND attempts<12 ORDER BY rowid LIMIT 1)
      RETURNING *`).get(lease, now + 10 * 60_000, now) as unknown as SparkQueueRow | undefined
    if (!row) return null
    const job = JSON.parse(row.job) as SparkJob
    return { runId: row.id, lease, operation: row.state === 'dispatching' ? 'dispatch' as const : 'poll' as const,
      taskUrl: row.task_url, prompt: sparkPrompt(job), expiresAt: job.expiresAt }
  }
  private leased(id: string, lease: string): SparkQueueRow {
    const row = this.get(id)
    if (!['dispatching', 'polling'].includes(row.state) || row.lease !== lease || row.lease_until <= this.clock()) throw new Error('有効な作業リースがありません')
    return row
  }
  report(id: string, lease: string, result: { state: 'waiting' | 'complete' | 'blocked'; taskUrl?: string; response?: string; reason?: string }) {
    const row = this.leased(id, lease)
    if (!['waiting','complete','blocked'].includes(result.state)) throw new Error('結果状態が不正です')
    const url = result.taskUrl || row.task_url
    if (url && (!validSparkTaskUrl(url) || (row.task_url && url !== row.task_url))) throw new Error('SparkタスクURLが不正または不一致です')
    let state: SparkState, payload: unknown = null
    let reason: string | null = null
    if (result.state === 'complete') {
      if (typeof result.response !== 'string') throw new Error('完成した応答が必要です')
      payload = validateSparkResponse(JSON.parse(row.job) as SparkJob, result.response, new Date(this.clock()))
      state = 'needs_review'
    } else if (result.state === 'waiting') {
      if (!url) throw new Error('待機には送信済みSparkタスクURLが必要です')
      state = row.attempts >= 12 ? 'blocked' : 'awaiting'
      if (state === 'blocked') reason = '自動確認回数の上限です'
    } else {
      state = 'blocked'; reason = (result.reason || '本人操作または接続確認が必要です').slice(0, 500)
    }
    const update = this.db.prepare('UPDATE spark_job SET state=?,task_url=?,result=?,reason=?,lease=NULL,next_poll=? WHERE id=? AND lease=? AND lease_until>?')
      .run(state, url, payload === null ? null : JSON.stringify(payload), reason, this.clock() + 10 * 60_000, id, lease, this.clock())
    if (update.changes !== 1) throw new Error('作業リースが更新されています')
    return this.status(id)
  }
  reconcile(id: string, taskUrl: string) {
    if (!validSparkTaskUrl(taskUrl)) throw new Error('SparkタスクURLが不正です')
    this.recover()
    const row = this.get(id)
    if (row.state !== 'blocked') throw new Error('照合待ちの依頼ではありません')
    this.db.prepare("UPDATE spark_job SET state='awaiting',task_url=?,attempts=0,next_poll=0,reason=NULL WHERE id=? AND state='blocked'").run(taskUrl, id)
    return this.status(id)
  }
}
