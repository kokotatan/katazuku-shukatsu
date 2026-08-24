/** google-workspace MCPへ渡す前の、モデル非依存の外向き通信ポリシー。 */

const RECIPIENT_KEYS = new Set([
  'to', 'cc', 'bcc', 'recipient', 'recipients', 'to_email', 'to_emails', 'cc_emails', 'bcc_emails',
])

function emailsIn(value) {
  if (Array.isArray(value)) return value.flatMap(emailsIn)
  if (typeof value !== 'string') return []
  return value.toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?/g) || []
}

function recipientsOf(args) {
  if (!args || typeof args !== 'object') return []
  const recipients = []
  for (const [key, value] of Object.entries(args)) {
    if (RECIPIENT_KEYS.has(key.toLowerCase())) recipients.push(...emailsIn(value))
  }
  return [...new Set(recipients)]
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

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value))
}

function approvedCallMatches(message, approvedCall) {
  if (!approvedCall || typeof approvedCall !== 'object') return false
  const actual = {
    name: String(message.params?.name || '').toLowerCase(),
    arguments: message.params?.arguments ?? {},
  }
  const approved = {
    name: String(approvedCall.name || '').toLowerCase(),
    arguments: approvedCall.arguments ?? {},
  }
  return canonicalJson(actual) === canonicalJson(approved)
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
 * send_gmail_messageだけを対象に、全宛先(to/cc/bcc)と本人承認内容を検査する。
 * 第三者宛は、送信tool・宛先・件名・本文・添付を含むargumentsが本人へ提示した内容と
 * 完全一致し、かつgmail.send.confirmed capabilityがある場合に一度だけ許可する。
 * 宛先を省略した返信は検証不能なので拒否する。
 */
export function evaluateWorkspaceToolCall(message, selfEmails, capabilities = [], approvedCall) {
  if (!message || typeof message !== 'object' || message.method !== 'tools/call') return { allow: true }
  const name = String(message.params?.name || '').toLowerCase()
  const granted = new Set((capabilities || []).map((value) => String(value).trim()).filter(Boolean))
  if (!name.includes('send_gmail_message')) {
    const required = requiredCapability(name)
    if (granted.size && (!required || !granted.has(required))) {
      return { allow: false, reason: `このworkflowに許可されていないGoogle Workspace操作です: ${name}` }
    }
    return { allow: true }
  }
  const allowed = new Set((selfEmails || []).map((email) => String(email).trim().toLowerCase()).filter(Boolean))
  const recipients = recipientsOf(message.params?.arguments)
  if (!recipients.length) {
    return { allow: false, reason: '送信先をコードで検証できないため拒否しました。宛先を明示して本人確認を取り直してください。' }
  }
  const external = recipients.filter((email) => !allowed.has(email))
  if (external.length) {
    if (!granted.has('gmail.send.confirmed')) {
      return { allow: false, reason: `第三者宛メール送信にはgmail.send.confirmed capabilityが必要です: ${external.join(', ')}` }
    }
    if (!approvedCallMatches(message, approvedCall)) {
      return { allow: false, reason: `本人が確認した送信内容と一致しないため拒否しました: ${external.join(', ')}` }
    }
    return { allow: true, consumeApproval: true }
  }
  if (granted.size && !granted.has('gmail.send.self') && !granted.has('gmail.send.confirmed')) {
    return { allow: false, reason: `このworkflowに許可されていないGoogle Workspace操作です: ${name}` }
  }
  return { allow: true }
}

export function blockedToolResult(id, reason) {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      content: [{ type: 'text', text: reason }],
      isError: true,
    },
  }
}
