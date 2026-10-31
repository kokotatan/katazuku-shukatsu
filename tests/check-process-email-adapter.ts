import assert from 'node:assert/strict'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProcessEmailDeliveryAdapter } from '../src/process-email-adapter.js'
import type { ThirdPartyEmailAction } from '../src/third-party-email.js'

const here = fileURLToPath(new URL('.', import.meta.url))
const action: ThirdPartyEmailAction = {
  actionType: 'email.send',
  target: { provider: 'icloud-mail', senderEmail: 'contact@example.com', context: 'business', to: ['recipient@example.com'], counterpartyName: 'Example' },
  content: { subject: '件名', body: '本文', threadId: 'thread', sourceMessageId: 'message', scheduleCommitments: [] },
  effectiveAt: 'immediate', notification: '送信される',
}
const adapter = new ProcessEmailDeliveryAdapter({ executable: process.execPath, args: [join(here, 'fixtures', 'email-adapter.mjs')] })
assert.deepEqual(await adapter.reconcile(action), { state: 'sent', receiptRef: 'fixture:sent' })
await adapter.send(action)
assert.throws(() => new ProcessEmailDeliveryAdapter({ executable: 'node' }), /絶対パス/)
console.log('プロセス型メールadapter: shell不使用・環境制限・JSON契約を確認')
