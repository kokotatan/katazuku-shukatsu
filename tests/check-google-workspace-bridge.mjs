import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const bridge = resolve(root, 'scripts', 'google-workspace-bridge.mjs')
const upstream = resolve(root, 'tests', 'fixtures', 'google-workspace-upstream.mjs')
const OWNER = ['owner', 'example.test'].join('@')
const RECRUITER = ['recruiter', 'example.test'].join('@')
const EXTERNAL = ['external', 'example.test'].join('@')
const ATTACKER = ['attacker', 'example.test'].join('@')
const HIDDEN = ['hidden', 'example.test'].join('@')

function sendCall(child, id, name, args = {}) {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }) + '\n')
}

async function runBridge({ capabilities, approvedCall }, actions) {
  const env = {
    ...process.env,
    KATAZUKU_GOOGLE_MCP_COMMAND: process.execPath,
    KATAZUKU_GOOGLE_MCP_ARGS_JSON: JSON.stringify([upstream]),
    KATAZUKU_WORKSPACE_SELF_EMAILS: JSON.stringify([OWNER]),
    KATAZUKU_WORKSPACE_ALLOWED_SENDERS: JSON.stringify([OWNER]),
    KATAZUKU_WORKSPACE_CAPABILITIES: JSON.stringify(capabilities),
  }
  if (approvedCall) {
    env.KATAZUKU_APPROVED_WORKSPACE_CALL_B64 = Buffer.from(JSON.stringify(approvedCall)).toString('base64url')
  }
  const child = spawn(process.execPath, [bridge], { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  actions(child)
  child.stdin.end()
  const [code] = await once(child, 'exit')
  assert.equal(code, 0, stderr)
  return stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
}

const selfArgs = {
  user_google_email: OWNER,
  to: [OWNER],
  cc: [],
  bcc: [],
  subject: 'Daily summary',
  body: 'Synthetic body',
  body_format: 'plain',
}
const approvedArgs = {
  user_google_email: OWNER,
  to: [RECRUITER],
  cc: [OWNER],
  bcc: [],
  subject: 'Approved subject',
  body: 'Approved synthetic body',
  body_format: 'plain',
  attachments: [{ path: 'synthetic.pdf', sha256: '0'.repeat(64) }],
}

const selfResponses = await runBridge({ capabilities: ['gmail.send.self', 'gmail.read', 'drive.read', 'sheets.read'] }, (child) => {
  sendCall(child, 1, 'send_gmail_message', selfArgs)
  sendCall(child, 2, 'send_gmail_message', { ...selfArgs, cc: [EXTERNAL] })
  sendCall(child, 3, 'send_gmail_message', { ...selfArgs, user_google_email: ATTACKER })
  sendCall(child, 4, 'send_gmail_message', { ...selfArgs, user_google_email: undefined })
  sendCall(child, 5, 'search_gmail_messages', { user_google_email: OWNER, query: 'synthetic' })
  sendCall(child, 6, 'delete_everything', {})
  for (const [offset, tool] of ['delete_gmail_message', 'manage_gmail_filter', 'send_draft_gmail_message',
    'create_drive_file', 'manage_drive_access', 'set_drive_file_permissions', 'create_spreadsheet',
    'create_sheet', 'manage_spreadsheet_comment', 'unknown_search_gmail_messages'].entries()) {
    sendCall(child, 30 + offset, tool, selfArgs)
  }
  sendCall(child, 40, 'send_gmail_message', { ...selfArgs, bcc: { address: EXTERNAL } })
  sendCall(child, 41, 'send_gmail_message', { ...selfArgs, to: `${OWNER}\r\nBcc: ${EXTERNAL}` })
  sendCall(child, 42, 'send_gmail_message', { ...selfArgs, to: [OWNER, 'unknown-local-alias'] })
  sendCall(child, 43, 'send_gmail_message', { ...selfArgs, from: 'unverifiable-alias' })
  sendCall(child, 44, 'get_drive_file_content', { user_google_email: OWNER, file_id: 'synthetic-file' })
  child.stdin.write(JSON.stringify([{ jsonrpc: '2.0', id: 45, method: 'tools/call',
    params: { name: 'send_gmail_message', arguments: { ...selfArgs, to: [EXTERNAL] } } }]) + '\n')
})
assert.match(selfResponses.find((item) => item.id === 1).result.content[0].text, /^upstream:/)
for (const id of [2, 3, 4, 6, ...Array.from({ length: 14 }, (_, i) => 30 + i)]) {
  assert.equal(selfResponses.find((item) => item.id === id).result.isError, true, `blocked call ${id} reached upstream`)
}
assert.match(selfResponses.find((item) => item.id === 5).result.content[0].text, /^upstream:/)
assert.match(selfResponses.find((item) => item.id === 44).result.content[0].text, /^upstream:/)
assert.equal(selfResponses.find((item) => item.id == null)?.result.isError, true, 'JSON-RPC batch reached upstream')

const approvedResponses = await runBridge({
  capabilities: ['gmail.send.confirmed'],
  approvedCall: { name: 'send_gmail_message', arguments: approvedArgs },
}, (child) => {
  sendCall(child, 10, 'send_gmail_message', { ...approvedArgs, body: 'Modified body' })
  sendCall(child, 11, 'send_gmail_message', { ...approvedArgs, bcc: [HIDDEN] })
  const deep = '['.repeat(15000) + '0' + ']'.repeat(15000)
  child.stdin.write('{"jsonrpc":"2.0","id":14,"method":"tools/call","params":{"name":"send_gmail_message","arguments":'
    + JSON.stringify(approvedArgs).slice(0, -1) + ',"deep":' + deep + '}}}\n')
  sendCall(child, 12, 'send_gmail_message', approvedArgs)
  sendCall(child, 13, 'send_gmail_message', approvedArgs)
})
assert.equal(approvedResponses.find((item) => item.id === 10).result.isError, true)
assert.equal(approvedResponses.find((item) => item.id === 11).result.isError, true)
assert.match(approvedResponses.find((item) => item.id === 12).result.content[0].text, /^upstream:/)
assert.equal(approvedResponses.find((item) => item.id === 13).result.isError, true)
assert.equal(approvedResponses.find((item) => item.id === 14).result.isError, true, 'policy validation exception reached upstream')

const noCapability = await runBridge({ capabilities: [] }, (child) => {
  sendCall(child, 20, 'send_gmail_message', selfArgs)
  sendCall(child, 21, 'search_gmail_messages', {})
})
assert.equal(noCapability.find((item) => item.id === 20).result.isError, true)
assert.equal(noCapability.find((item) => item.id === 21).result.isError, true)

console.log('Google Workspace bridge: synthetic tools/call policy checks passed')
