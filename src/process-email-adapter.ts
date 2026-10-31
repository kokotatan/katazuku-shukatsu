import { spawn } from 'node:child_process'
import { isAbsolute } from 'node:path'
import type { EmailDeliveryAdapter, EmailDeliveryState, ThirdPartyEmailAction } from './third-party-email.js'

export interface ProcessEmailAdapterOptions {
  executable: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  timeoutMs?: number
}

const MAX_OUTPUT_BYTES = 64 * 1024

function validateOptions(options: ProcessEmailAdapterOptions): void {
  if (!isAbsolute(options.executable)) throw new Error('メールadapterの実行ファイルは絶対パスで指定してください')
  if (options.cwd && !isAbsolute(options.cwd)) throw new Error('メールadapterのcwdは絶対パスで指定してください')
  for (const item of options.args ?? []) if (/[\r\n\0]/.test(item)) throw new Error('メールadapterの引数が不正です')
  for (const [key, value] of Object.entries(options.env ?? {})) {
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(key) || /[\0]/.test(value)) throw new Error('メールadapterの環境変数が不正です')
  }
}

function exactDeliveryState(value: unknown): EmailDeliveryState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('メールadapterの応答が不正です')
  const record = value as Record<string, unknown>
  const extras = Object.keys(record).filter((key) => !['state', 'receiptRef'].includes(key))
  if (extras.length || !['sent', 'not_sent', 'unknown'].includes(String(record.state))) throw new Error('メールadapterの応答が不正です')
  if (record.receiptRef !== undefined && (typeof record.receiptRef !== 'string' || !record.receiptRef.trim() || record.receiptRef.length > 512)) {
    throw new Error('メールadapterのreceiptRefが不正です')
  }
  return { state: record.state as EmailDeliveryState['state'], ...(record.receiptRef ? { receiptRef: record.receiptRef as string } : {}) }
}

export class ProcessEmailDeliveryAdapter implements EmailDeliveryAdapter {
  constructor(private readonly options: ProcessEmailAdapterOptions) { validateOptions(options) }

  private invoke(operation: 'reconcile' | 'send', action: ThirdPartyEmailAction): Promise<unknown> {
    const timeoutMs = this.options.timeoutMs ?? 45_000
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) throw new Error('メールadapterのtimeoutMsが不正です')
    return new Promise((resolve, reject) => {
      const child = spawn(this.options.executable, this.options.args ?? [], {
        cwd: this.options.cwd,
        env: {
          SYSTEMROOT: process.env.SYSTEMROOT ?? '',
          WINDIR: process.env.WINDIR ?? '',
          PATH: process.env.PATH ?? '',
          TEMP: process.env.TEMP ?? '',
          TMP: process.env.TMP ?? '',
          ...this.options.env,
        },
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      let stdout = Buffer.alloc(0)
      let stderr = Buffer.alloc(0)
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        child.kill()
        reject(new Error('メールadapterが時間内に終了しませんでした'))
      }, timeoutMs)
      const collect = (current: Buffer, chunk: Buffer) => {
        const next = Buffer.concat([current, chunk])
        if (next.length > MAX_OUTPUT_BYTES) throw new Error('メールadapterの出力が上限を超えました')
        return next
      }
      child.stdout.on('data', (chunk: Buffer) => {
        try { stdout = collect(stdout, chunk) } catch (error) { if (!settled) { settled = true; clearTimeout(timer); child.kill(); reject(error) } }
      })
      child.stderr.on('data', (chunk: Buffer) => {
        try { stderr = collect(stderr, chunk) } catch (error) { if (!settled) { settled = true; clearTimeout(timer); child.kill(); reject(error) } }
      })
      child.on('error', (error) => { clearTimeout(timer); if (!settled) { settled = true; reject(new Error(`メールadapterを起動できません: ${error.message}`)) } })
      child.on('close', (code) => {
        clearTimeout(timer)
        if (settled) return
        settled = true
        if (code !== 0) return reject(new Error('メールadapterが失敗しました。秘密値を含まないadapterログを確認してください'))
        try { resolve(JSON.parse(stdout.toString('utf8'))) } catch { reject(new Error('メールadapterのJSON応答が不正です')) }
      })
      child.stdin.end(JSON.stringify({ operation, action }))
    })
  }

  async reconcile(action: ThirdPartyEmailAction): Promise<EmailDeliveryState> {
    return exactDeliveryState(await this.invoke('reconcile', action))
  }

  async send(action: ThirdPartyEmailAction): Promise<void> {
    const result = await this.invoke('send', action)
    if (!result || typeof result !== 'object' || Array.isArray(result)
      || Object.keys(result as Record<string, unknown>).some((key) => !['accepted'].includes(key))
      || (result as Record<string, unknown>).accepted !== true) {
      throw new Error('メールadapterの送信応答が不正です')
    }
  }
}
