import { createHash } from 'node:crypto'

export interface MailInput {
  accounts: { status: string }[]
  messages: { id: string; [key: string]: unknown }[]
}
export interface ExtractionCoverage {
  status: 'completed' | 'failed'
  inputDigest: string
  reviewedMessageIds: string[]
}

export function inputDigest(input: MailInput): string {
  return createHash('sha256').update(JSON.stringify(input.messages)).digest('hex')
}

export function validateMailInput(input: MailInput): void {
  // partialは本文を取れなかった通だけが欠けた状態(gmail-fetch.tsがIDを記録済み)。取れた分は反映する。
  if (!Array.isArray(input.accounts) || !input.accounts.length || input.accounts.some(a => a.status !== 'success' && a.status !== 'partial')) {
    throw new Error('メール取得が未完了です')
  }
  if (!Array.isArray(input.messages) || input.messages.some(m => !m.id || typeof m.id !== 'string')) {
    throw new Error('メール入力のIDが不正です')
  }
  // 同一IDを複数回扱うと網羅性を数だけで誤判定するため、入力で拒否する。
  if (new Set(input.messages.map(m => m.id)).size !== input.messages.length) throw new Error('メール入力に重複IDがあります')
}

export function validateCoverage(input: MailInput, coverage?: ExtractionCoverage): void {
  validateMailInput(input)
  if (coverage?.status !== 'completed' || coverage.inputDigest !== inputDigest(input)) {
    throw new Error('メール抽出が未完了、または入力が一致しません')
  }
  const expected = new Set(input.messages.map(m => m.id))
  const reviewed = coverage.reviewedMessageIds
  if (!Array.isArray(reviewed) || reviewed.length !== expected.size || new Set(reviewed).size !== expected.size || reviewed.some(id => !expected.has(id))) {
    throw new Error('メール抽出の確認済みIDが入力全件と一致しません')
  }
}

export function splitMailInput(input: MailInput, maxChars = 200_000, maxMessages = 80): MailInput[] {
  validateMailInput(input)
  const batches: MailInput[] = []
  let messages: MailInput['messages'] = []
  let size = 0
  for (const message of [...input.messages].sort((a, b) => String(a.receivedAt).localeCompare(String(b.receivedAt)))) {
    const length = JSON.stringify(message).length
    if (length > maxChars) throw new Error(`メール本文がバッチ上限を超えます: ${message.id}。省略せず別途処理してください`)
    if (messages.length && (size + length > maxChars || messages.length >= maxMessages)) {
      batches.push({ accounts: input.accounts, messages })
      messages = []
      size = 0
    }
    messages.push(message)
    size += length
  }
  if (messages.length) batches.push({ accounts: input.accounts, messages })
  return batches
}
