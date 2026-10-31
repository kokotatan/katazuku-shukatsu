/** Google Workspace MCP の tools/call 境界で強制する、モデル非依存の外向き通信ポリシー。 */

const RECIPIENT_KEYS = new Set([
  'to', 'cc', 'bcc', 'recipient', 'recipients', 'to_email', 'to_emails', 'cc_emails', 'bcc_emails',
])
const SENDER_KEYS = new Set([
  'user_google_email', 'sender', 'sender_email', 'from', 'from_email',
])

function emailsIn(value) {
  if (Array.isArray(value)) return value.flatMap(emailsIn)
  if (typeof value !== 'string') return []
  return value.toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?/g) || []
}

function emailsForKeys(args, keys) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return []
  const emails = []
  for (const [key, value] of Object.entries(args)) {
    if (keys.has(key.toLowerCase())) emails.push(...emailsIn(value))
  }
  return [...new Set(emails)]
}

export function recipientsOf(args) {
  return emailsForKeys(args, RECIPIENT_KEYS)
}

export function sendersOf(args) {
  return emailsForKeys(args, SENDER_KEYS)
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonicalize(item)]))
  }
  return value
}

export function canonicalWorkspaceCall(message) {
  return JSON.stringify(canonicalize({
    name: String(message?.params?.name || '').toLowerCase(),
    arguments: message?.params?.arguments ?? {},
  }))
}

function approvedCallMatches(message, approvedCall) {
  if (!approvedCall || typeof approvedCall !== 'object') return false
  return canonicalWorkspaceCall(message) === canonicalWorkspaceCall({
    params: { name: approvedCall.name, arguments: approvedCall.arguments },
  })
}

function requiredCapability(toolName) {
  const name = toolName.toLowerCase()
  if (name.includes('draft_gmail_message')) return 'gmail.draft'
  if (name.includes('gmail') && /(label|modify)/.test(name)) return 'gmail.labels'
  if (name.includes('gmail')) return 'gmail.read'
  if (/(manage_event|create_calendar)/.test(name)) return 'calendar.write'
  if (/(get_events|list_calendars|query_freebusy)/.test(name)) return 'calendar.read'
  if (/(modify_sheet|append_table)/.test(name)) return 'sheets.write'
  if (/(sheet|spreadsheet)/.test(name)) return 'sheets.read'
  if (name.includes('drive')) return 'drive.read'
  return undefined
}

/**
 * send_gmail_message は送信元と全宛先(to/cc/bcc)を必須にする。
 * 第三者宛は、tool名・送信元・全宛先・件名・本文・添付を含む arguments の完全一致承認を
 * gmail.send.confirmed capability と同時に満たした場合だけ、一度だけ許可する。
 */
export function evaluateWorkspaceToolCall(message, policy = {}) {
  if (!message || typeof message !== 'object' || message.method !== 'tools/call') return { allow: true }

  const name = String(message.params?.name || '').toLowerCase()
  const granted = new Set((policy.capabilities || []).map((value) => String(value).trim()).filter(Boolean))
  const isSend = name.includes('send_gmail_message')
  if (!isSend) {
    const required = requiredCapability(name)
    if (!required || !granted.has(required)) {
      return { allow: false, reason: `このworkflowに許可されていないGoogle Workspace操作です: ${name || '(tool名なし)'}` }
    }
    return { allow: true }
  }

  const args = message.params?.arguments
  const recipients = recipientsOf(args)
  if (!recipients.length) {
    return { allow: false, reason: 'to/cc/bccをコードで検証できないため送信を拒否しました。宛先を明示してください。' }
  }

  const senders = sendersOf(args)
  if (senders.length !== 1) {
    return { allow: false, reason: '送信元を一意に検証できないため送信を拒否しました。user_google_emailを明示してください。' }
  }
  const allowedSenders = new Set((policy.allowedSenderEmails || []).map((email) => String(email).trim().toLowerCase()).filter(Boolean))
  if (!allowedSenders.has(senders[0])) {
    return { allow: false, reason: `許可されていない送信元のため送信を拒否しました: ${senders[0]}` }
  }

  const selfEmails = new Set((policy.selfEmails || []).map((email) => String(email).trim().toLowerCase()).filter(Boolean))
  const external = recipients.filter((email) => !selfEmails.has(email))
  if (external.length) {
    if (!granted.has('gmail.send.confirmed')) {
      return { allow: false, reason: `第三者宛メール送信にはgmail.send.confirmed capabilityが必要です: ${external.join(', ')}` }
    }
    if (!approvedCallMatches(message, policy.approvedCall)) {
      return { allow: false, reason: `本人が確認した送信内容と完全一致しないため拒否しました: ${external.join(', ')}` }
    }
    return { allow: true, consumeApproval: true }
  }

  if (!granted.has('gmail.send.self') && !granted.has('gmail.send.confirmed')) {
    return { allow: false, reason: '本人宛メール送信にはgmail.send.self capabilityが必要です。' }
  }
  return { allow: true }
}

export function blockedToolResult(id, reason) {
  return {
    jsonrpc: '2.0',
    id,
    result: { content: [{ type: 'text', text: reason }], isError: true },
  }
}
