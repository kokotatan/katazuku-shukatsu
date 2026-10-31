import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { atomicWrite, portalsPath, readPresets, readRegistry } from './settings.mjs'
import { normalizeAllowedUrlPrefix, validatePortalId } from './lib.mjs'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

function parseArgs(argv) {
  const result = { replace: false }
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (key === '--replace') { result.replace = true; continue }
    if (!['--id', '--label', '--login-url', '--auth-mode', '--preset'].includes(key) || index + 1 >= argv.length) {
      throw new Error('引数は --id --label --login-url --auth-mode [--preset] [--replace] で指定してください')
    }
    if (Object.hasOwn(result, key.slice(2))) throw new Error(`引数が重複しています: ${key}`)
    result[key.slice(2)] = argv[index + 1]
    index += 1
  }
  return result
}

export async function configurePortal({ root = repoRoot, id, label, loginUrl, authMode, presetId = '', replace = false }) {
  id = validatePortalId(id)
  if (!['password', 'sso'].includes(authMode)) throw new Error('auth-modeはpasswordまたはssoです')
  if (typeof loginUrl !== 'string' || loginUrl.length > 2048) throw new Error('login-urlが不正です')
  normalizeAllowedUrlPrefix(loginUrl)
  const presets = await readPresets(root)
  const preset = presetId ? presets.find((item) => item.id === presetId) : null
  if (presetId && !preset) throw new Error('指定したpresetがありません')
  label = preset?.label || String(label || '').trim()
  if (!label || label.length > 100 || /[\u0000-\u001f]/.test(label)) throw new Error('labelは100文字以内で指定してください')

  const current = await readRegistry(root)
  if (Object.hasOwn(current, id) && !replace) throw new Error('既に登録済みです。変更時だけ--replaceを指定してください')
  const profileVersion = randomUUID()
  const configuredAt = new Date().toISOString()
  const localPath = portalsPath(root)
  const local = await readFile(localPath, 'utf8').then((value) => JSON.parse(value.replace(/^\uFEFF/, '')), (error) => {
    if (error.code === 'ENOENT') return { version: 1, portals: {} }
    throw error
  })
  if (local.version !== 1 || !local.portals || typeof local.portals !== 'object' || Array.isArray(local.portals)) {
    throw new Error('端末内のポータル設定が不正です')
  }
  const next = { version: 1, portals: { ...local.portals, [id]: {
    label, loginUrl, authMode, presetId: preset?.id || '', profileVersion, configuredAt,
  } } }
  await mkdir(join(root, 'logs'), { recursive: true })
  await atomicWrite(localPath, JSON.stringify(next, null, 2) + '\n')
  return {
    id, label, authMode, loginUrl,
    credentialPath: join(root, 'credential-store', `${id}-${profileVersion}.json`),
    reauthenticationRequired: true,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const result = await configurePortal({
    id: args.id, label: args.label, loginUrl: args['login-url'], authMode: args['auth-mode'],
    presetId: args.preset || '', replace: args.replace,
  })
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1 })
}
