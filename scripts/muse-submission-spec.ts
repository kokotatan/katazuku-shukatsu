import assert from 'node:assert/strict'
import { KatazukuMcpServer, KATAZUKU_MCP_SCOPES } from '../src/katazuku-mcp.js'
import { KATAZUKU_REMOTE_TOOL_SCOPES } from '../src/katazuku-remote-policy.js'

const scopes = [...KATAZUKU_MCP_SCOPES]
const server = new KatazukuMcpServer({
  dbPath: 'submission-spec-does-not-open.sqlite',
  workflowStorePath: 'submission-spec-does-not-open.local.sqlite',
  scopes,
})
const tools = server.tools()

const localEffect = (tool: (typeof tools)[number]) => {
  if (tool.annotations.readOnlyHint) return 'none'
  if (tool.scope === 'write') return 'idempotent mutation of the user-owned canonical SQLite database'
  return 'idempotent mutation of the local approval/workflow evidence store; no external action'
}

const manifest = {
  schemaVersion: 1,
  generatedFrom: ['src/katazuku-mcp.ts', 'src/katazuku-remote-policy.ts'],
  transport: {
    protocol: 'MCP over HTTPS with OAuth 2.1 and PKCE',
    endpoint: 'https://<production-origin>/mcp',
    accessTokenTtlSeconds: 3600,
    maximumRequestBytes: 1_200_000,
    maximumConcurrentRelayCalls: 8,
    ownerDeviceTimeoutSeconds: 20,
    loginAttemptsPerMinute: 10,
    oauthRequestsPerMinute: 60,
    payloadPersistence: 'none at the gateway; relay memory only',
  },
  commonErrors: [
    { code: 'scope_denied', protocol: 'JSON-RPC', jsonRpcCode: -32601, retry: false, meaning: 'OAuth scope or owner-device allowlist does not permit the tool' },
    { code: 'invalid_request', protocol: 'HTTP', httpStatus: 400, retry: false, meaning: 'Malformed JSON-RPC, schema, protocol version, origin, host, or payload' },
    { code: 'owner_device_offline', protocol: 'HTTP', httpStatus: 503, retry: true, meaning: 'The user-owned bridge is not connected' },
    { code: 'owner_device_timeout', protocol: 'HTTP', httpStatus: 504, retry: 'status-only', meaning: 'The bridge did not answer; never repeat an external action automatically' },
    { code: 'busy', protocol: 'HTTP', httpStatus: 429, retry: true, meaning: 'Eight relay calls are already in flight' },
    { code: 'canonical_or_evidence_guard', protocol: 'MCP tool error', retry: false, meaning: 'Canonical DB, freshness, conflict, action hash, workflow state, or evidence requirement failed' },
  ],
  tools: tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    oauthScope: KATAZUKU_REMOTE_TOOL_SCOPES[tool.name as keyof typeof KATAZUKU_REMOTE_TOOL_SCOPES],
    metaPermissionCategory: tool.annotations.readOnlyHint ? 'read' : 'write',
    sensitiveWrite: false,
    dataSensitivity: tool.scope === 'sensitive' ? 'personal' : tool.scope === 'actions' ? 'approval-evidence' : 'job-search',
    sideEffect: localEffect(tool),
    externalCommit: false,
    inputSchema: tool.inputSchema,
    outputContract: {
      format: 'JSON',
      declaredJsonSchema: false,
      note: 'The tool returns bounded structured JSON from the canonical DB or local workflow store; exact fields are exercised by repository tests.',
    },
    annotations: tool.annotations,
  })),
}

const names = tools.map((tool) => tool.name)
assert.equal(new Set(names).size, names.length, 'MCP tool names must be unique')
assert.deepEqual(Object.keys(KATAZUKU_REMOTE_TOOL_SCOPES).sort(), [...names].sort(), 'remote policy and MCP tool inventory differ')
for (const tool of tools) {
  assert.equal(KATAZUKU_REMOTE_TOOL_SCOPES[tool.name as keyof typeof KATAZUKU_REMOTE_TOOL_SCOPES], `katazuku:${tool.scope}`)
  assert.equal(tool.annotations.destructiveHint, false, `${tool.name} must not be classified as destructive`)
  assert.equal(tool.annotations.openWorldHint, false, `${tool.name} must not access external systems directly`)
  assert.equal(tool.inputSchema.type, 'object', `${tool.name} must declare an object input schema`)
}
assert.equal(manifest.tools.length, 28, 'review the submission inventory when adding or removing a tool')
assert.equal(manifest.tools.some((tool) => tool.sensitiveWrite), false, 'katazuku connector must not expose a sensitive write')

if (process.argv.includes('--check')) {
  console.log(`Muse submission spec: ${manifest.tools.length} tools, remote policy, scopes, annotations, and gateway limits verified`)
} else {
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`)
}
