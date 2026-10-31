import assert from 'node:assert/strict'
import { actionHash, buildMessage, findSent, searchInbox, validateConfig, validateInboxQuery, validateRequest } from './lib.mjs'

const config = validateConfig({
  version: 1,
  senderEmail: 'contact@example.com',
  credentialBroker: { executable: process.execPath, args: ['fixture'] },
})
const action = {
  actionType: 'email.send',
  target: { provider: 'icloud-mail', senderEmail: 'contact@example.com', context: 'business', to: ['recipient@example.com'], counterpartyName: 'Example' },
  content: { subject: '件名', body: '本文', threadId: 'thread', sourceMessageId: 'message', scheduleCommitments: [] },
  effectiveAt: 'immediate', notification: '送信される',
}
assert.equal(validateRequest({ operation: 'send', action }, config).action, action)
assert.throws(() => validateRequest({ operation: 'send', action: { ...action, target: { ...action.target, senderEmail: 'other@example.com' } } }, config), /固定/)
assert.throws(() => validateConfig({ ...config, smtpHost: 'evil.example' }), /未知/)
const built = buildMessage(action)
assert.equal(built.hash, actionHash(action))
assert.equal(built.message.from, 'contact@example.com')
assert.equal(built.message.headers['X-Katazuku-Action-Hash'], built.hash)

class FakeImap {
  constructor(options) {
    assert.equal(options.host, 'imap.mail.me.com')
    assert.equal(options.port, 993)
    assert.equal(options.secure, true)
  }
  on() {}
  async connect() {}
  async list() { return [{ path: 'Sent Messages', specialUse: '\\Sent' }] }
  async getMailboxLock(path) { assert.equal(path, 'Sent Messages'); return { release() {} } }
  async search(query) { assert.equal(query.header['X-Katazuku-Action-Hash'], built.hash); return [41, 42] }
  async logout() {}
  close() {}
}
assert.deepEqual(await findSent({ ImapFlow: FakeImap, config, credentials: { username: 'fixture', password: 'fixture' }, hash: built.hash }), {
  state: 'sent', receiptRef: 'icloud-imap:Sent Messages:42',
})
assert.throws(() => validateInboxQuery({}), /絞り込み/)
class FakeInboxImap {
  constructor(options) { assert.equal(options.host, 'imap.mail.me.com') }
  on() {}
  async connect() {}
  async getMailboxLock(path) { assert.equal(path, 'INBOX'); return { release() {} } }
  async search(query) { assert.equal(query.from, 'sender@example.com'); return [7] }
  async fetchOne(uid, query) {
    if (query.envelope) return { uid, size: 100, envelope: { subject: '連絡', messageId: '<m@example>', date: new Date('2099-01-01T00:00:00Z'), from: [{ address: 'sender@example.com' }], to: [{ address: 'contact@example.com' }] } }
    return { uid, source: Buffer.from('fixture') }
  }
  async logout() {}
  close() {}
}
const messages = await searchInbox({
  ImapFlow: FakeInboxImap,
  simpleParser: async () => ({ text: '本文', from: { value: [{ address: 'sender@example.com' }] }, to: { value: [{ address: 'contact@example.com' }] }, headers: new Map(), attachments: [] }),
  credentials: { username: 'fixture', password: 'fixture' }, query: { from: 'sender@example.com', limit: 1 },
})
assert.equal(messages[0].text, '本文')
const redacted = await searchInbox({
  ImapFlow: FakeInboxImap,
  simpleParser: async () => ({ text: '認証コード: 123456', headers: new Map(), attachments: [] }),
  credentials: { username: 'fixture', password: 'fixture' }, query: { from: 'sender@example.com', limit: 1 },
})
assert.equal(redacted[0].sensitiveAuthentication, true)
assert.equal(redacted[0].text, '')
console.log('iCloud Mail adapter: 固定host・送信元・action hash・SENT照合・受信検索・認証コード除外・broker境界を確認')
