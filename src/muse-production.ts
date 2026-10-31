import { createHash } from 'node:crypto'

type JsonObject = Record<string, unknown>

export type MuseProductionManifest = {
  schemaVersion: 1
  workerName: string
  publicOrigin: string
  endpoints: {
    mcp: string
    authorize: string
    token: string
    registration: string
    revocation: string
    metadata: string
  }
  compatibilityDate: string
  networkExposure: 'workers.dev' | 'custom-route'
  bindings: { oauthKv: string; relay: string }
  secrets: { requiredNames: string[]; valuesRecorded: false }
}

export type MuseProductionValidation = {
  ok: boolean
  errors: string[]
  manifest?: MuseProductionManifest
}

const object = (value: unknown): JsonObject | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined

const array = (value: unknown): unknown[] => Array.isArray(value) ? value : []

/** URL文字列を壊さず、JSONCのコメントと末尾commaだけを取り除く。 */
export function parseJsonc(source: string): unknown {
  let output = ''
  let quoted = false
  let escaped = false
  let lineComment = false
  let blockComment = false
  for (let index = 0; index < source.length; index++) {
    const current = source[index]
    const next = source[index + 1]
    if (lineComment) {
      if (current === '\n' || current === '\r') { lineComment = false; output += current }
      else output += ' '
      continue
    }
    if (blockComment) {
      if (current === '*' && next === '/') { blockComment = false; output += '  '; index++ }
      else output += current === '\n' || current === '\r' ? current : ' '
      continue
    }
    if (!quoted && current === '/' && next === '/') { lineComment = true; output += '  '; index++; continue }
    if (!quoted && current === '/' && next === '*') { blockComment = true; output += '  '; index++; continue }
    output += current
    if (quoted) {
      if (escaped) escaped = false
      else if (current === '\\') escaped = true
      else if (current === '"') quoted = false
    } else if (current === '"') quoted = true
  }

  let clean = ''
  quoted = false
  escaped = false
  for (let index = 0; index < output.length; index++) {
    const current = output[index]
    if (!quoted && current === ',') {
      let lookahead = index + 1
      while (/\s/.test(output[lookahead] || '')) lookahead++
      if (output[lookahead] === '}' || output[lookahead] === ']') continue
    }
    clean += current
    if (quoted) {
      if (escaped) escaped = false
      else if (current === '\\') escaped = true
      else if (current === '"') quoted = false
    } else if (current === '"') quoted = true
  }
  return JSON.parse(clean)
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex').toUpperCase()
}

export function validateMuseProductionConfig(value: unknown): MuseProductionValidation {
  const errors: string[] = []
  const config = object(value)
  if (!config) return { ok: false, errors: ['設定のrootはobjectである必要があります'] }

  const workerName = typeof config.name === 'string' ? config.name : ''
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(workerName)) errors.push('Worker名が未設定または不正です')
  if (config.main !== 'worker.ts') errors.push('mainはworker.tsへ固定してください')
  const compatibilityDate = typeof config.compatibility_date === 'string' ? config.compatibility_date : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(compatibilityDate)) errors.push('compatibility_dateが不正です')
  if (config.preview_urls !== false) errors.push('preview_urlsはfalseへ固定してください')
  if (object(config.observability)?.enabled !== false) errors.push('MCP payloadの意図しない記録を避けるためobservability.enabledはfalseへ固定してください')

  const vars = object(config.vars) || {}
  const rawOrigin = typeof vars.PUBLIC_ORIGIN === 'string' ? vars.PUBLIC_ORIGIN : ''
  let origin: URL | undefined
  try { origin = new URL(rawOrigin) } catch { errors.push('PUBLIC_ORIGINは有効なURLである必要があります') }
  if (origin) {
    if (origin.protocol !== 'https:') errors.push('PUBLIC_ORIGINはHTTPSである必要があります')
    if (rawOrigin !== origin.origin) errors.push('PUBLIC_ORIGINはpath、query、fragment、末尾slashを含まないoriginだけにしてください')
    if (origin.username || origin.password) errors.push('PUBLIC_ORIGINへ資格情報を含めないでください')
    if (/(^|\.)(example\.(com|org|net)|localhost)$/i.test(origin.hostname) || origin.hostname === '127.0.0.1') errors.push('PUBLIC_ORIGINにexampleまたはloopbackを使用できません')
  }
  for (const name of ['OWNER_KEY_SHA256', 'BRIDGE_TOKEN']) {
    if (Object.hasOwn(vars, name)) errors.push(`${name}をvarsへ平文設定せずwrangler secretを使用してください`)
  }

  const requiredSecrets = array(object(config.secrets)?.required).filter((item): item is string => typeof item === 'string').sort()
  for (const name of ['BRIDGE_TOKEN', 'OWNER_KEY_SHA256']) {
    if (!requiredSecrets.includes(name)) errors.push(`secrets.requiredに${name}がありません`)
  }

  const kv = array(config.kv_namespaces).map(object).find((item) => item?.binding === 'OAUTH_KV')
  const kvId = typeof kv?.id === 'string' ? kv.id : ''
  if (!/^[0-9a-f]{32}$/i.test(kvId)) errors.push('OAUTH_KVの実KV IDが未設定です')
  const relay = array(object(config.durable_objects)?.bindings).map(object).find((item) => item?.name === 'RELAY')
  if (relay?.class_name !== 'MuseRelay') errors.push('RELAY Durable ObjectをMuseRelayへ結び付けてください')
  const migration = array(config.migrations).map(object).find((item) => array(item?.new_sqlite_classes).includes('MuseRelay'))
  if (!migration) errors.push('MuseRelayのSQLite migrationがありません')

  const workersDev = config.workers_dev === true
  const hasRoute = typeof config.route === 'string' || array(config.routes).length > 0
  if (!workersDev && !hasRoute) errors.push('workers_devを無効にする場合はproduction routeを設定してください')
  if (workersDev && origin && !origin.hostname.endsWith('.workers.dev')) errors.push('workers_devを使うPUBLIC_ORIGINはworkers.dev hostと一致させてください')
  if (errors.length || !origin || !relay) return { ok: false, errors }

  return {
    ok: true,
    errors: [],
    manifest: {
      schemaVersion: 1,
      workerName,
      publicOrigin: origin.origin,
      endpoints: {
        mcp: `${origin.origin}/mcp`,
        authorize: `${origin.origin}/authorize`,
        token: `${origin.origin}/oauth/token`,
        registration: `${origin.origin}/oauth/register`,
        revocation: `${origin.origin}/oauth/token`,
        metadata: `${origin.origin}/.well-known/oauth-authorization-server`,
      },
      compatibilityDate,
      networkExposure: workersDev ? 'workers.dev' : 'custom-route',
      bindings: { oauthKv: 'OAUTH_KV', relay: 'RELAY' },
      secrets: { requiredNames: requiredSecrets, valuesRecorded: false },
    },
  }
}
