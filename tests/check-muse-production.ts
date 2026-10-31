import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseJsonc, sha256, validateMuseProductionConfig } from '../src/muse-production.js'

const valid = `{
  // URL内の//をコメントとして壊さない
  "name": "katazuku-muse-production",
  "main": "worker.ts",
  "compatibility_date": "2026-10-13",
  "workers_dev": true,
  "preview_urls": false,
  "observability": { "enabled": false },
  "vars": { "PUBLIC_ORIGIN": "https://katazuku-muse.example.workers.dev", },
  "secrets": { "required": ["OWNER_KEY_SHA256", "BRIDGE_TOKEN"] },
  "kv_namespaces": [{ "binding": "OAUTH_KV", "id": "0123456789abcdef0123456789abcdef" }],
  "durable_objects": { "bindings": [{ "name": "RELAY", "class_name": "MuseRelay" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["MuseRelay"] }],
}`

const parsed = parseJsonc(valid)
const result = validateMuseProductionConfig(parsed)
assert.equal(result.ok, true)
assert.equal(result.manifest?.endpoints.mcp, 'https://katazuku-muse.example.workers.dev/mcp')
assert.equal(result.manifest?.endpoints.revocation, 'https://katazuku-muse.example.workers.dev/oauth/token')
assert.equal(result.manifest?.secrets.valuesRecorded, false)

const invalid = (mutate: (config: Record<string, any>) => void, expected: string) => {
  const config = structuredClone(parsed) as Record<string, any>
  mutate(config)
  const checked = validateMuseProductionConfig(config)
  assert.equal(checked.ok, false)
  assert.ok(checked.errors.some((error) => error.includes(expected)), `${expected}: ${checked.errors.join(' / ')}`)
}

invalid((config) => { config.vars.PUBLIC_ORIGIN = 'http://localhost:8787' }, 'HTTPS')
invalid((config) => { config.vars.PUBLIC_ORIGIN = 'https://example.com' }, 'example')
invalid((config) => { config.vars.BRIDGE_TOKEN = 'secret-value' }, '平文設定')
invalid((config) => { config.kv_namespaces[0].id = 'REPLACE_WITH_KV_ID' }, '実KV ID')
invalid((config) => { config.observability.enabled = true }, 'observability.enabled')
invalid((config) => { config.workers_dev = false }, 'production route')
invalid((config) => { config.vars.PUBLIC_ORIGIN = 'https://connector.example.net/' }, 'originだけ')

assert.equal(Buffer.from(sha256('katazuku'), 'hex').toString('base64'), 'HL0xnm2fLliMtNvrX8A63FJuPfcE4nx7O430P1vdlrI=')
const incident = readFileSync(new URL('../docs/MUSE-INCIDENT-RESPONSE.md', import.meta.url), 'utf8')
for (const required of ['operator security contact', '48時間以内', 'credential broker', 'OAuth grantを失効', 'npm run check', '非送信の読取']) {
  assert.ok(incident.includes(required), `incident responseに必須手順がありません: ${required}`)
}
console.log('Muse production preflight: JSONC、HTTPS origin、秘密境界、KV/DO、ログ無効化、endpoint、hashを確認')
