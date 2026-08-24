import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

export const GOOGLE_WORKSPACE_CONFIG_VERSION = 1

/** @param {NodeJS.ProcessEnv} [env] @param {NodeJS.Platform} [platform] @param {string} [home] */
export function resolveGoogleWorkspaceConfigPath(
  env = process.env,
  platform = process.platform,
  home = homedir(),
) {
  if (env.KATAZUKU_GOOGLE_CONFIG) {
    return isAbsolute(env.KATAZUKU_GOOGLE_CONFIG)
      ? env.KATAZUKU_GOOGLE_CONFIG
      : resolve(env.KATAZUKU_GOOGLE_CONFIG)
  }

  if (platform === 'win32') {
    return join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'katazuku-shukatsu', 'google-workspace.json')
  }
  if (platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'katazuku-shukatsu', 'google-workspace.json')
  }
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'katazuku-shukatsu', 'google-workspace.json')
}

/** @param {unknown} value @param {string} name */
function requiredString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} がありません`)
  }
  return value.trim()
}

/** @param {unknown} input */
export function parseDesktopOAuthCredentials(input) {
  if (!input || typeof input !== 'object') throw new Error('OAuthクライアントJSONが不正です')
  const root = /** @type {{ installed?: { client_id?: unknown, client_secret?: unknown }, web?: unknown }} */ (input)
  if (!root.installed) {
    if (root.web) throw new Error('ウェブアプリではなく「デスクトップ アプリ」のOAuthクライアントを作成してください')
    throw new Error('OAuthクライアントJSONに installed 設定がありません')
  }

  const clientId = requiredString(root.installed.client_id, 'client_id')
  const clientSecret = requiredString(root.installed.client_secret, 'client_secret')
  if (!clientId.endsWith('.apps.googleusercontent.com')) {
    throw new Error('Google OAuthクライアントIDの形式が不正です')
  }
  return { clientId, clientSecret }
}

/** @param {{ clientId: string, clientSecret: string, accountEmail: string }} input */
export function createGoogleWorkspaceConfig(input) {
  const accountEmail = requiredString(input.accountEmail, 'Googleアカウント')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountEmail)) {
    throw new Error('Googleアカウントのメールアドレス形式が不正です')
  }
  return {
    schemaVersion: GOOGLE_WORKSPACE_CONFIG_VERSION,
    accountEmail,
    oauthClientId: requiredString(input.clientId, 'client_id'),
    oauthClientSecret: requiredString(input.clientSecret, 'client_secret'),
  }
}

/** @param {unknown} input */
export function validateGoogleWorkspaceConfig(input) {
  if (!input || typeof input !== 'object') throw new Error('Google Workspace設定が不正です')
  const config = /** @type {{ schemaVersion?: unknown, accountEmail?: unknown, oauthClientId?: unknown, oauthClientSecret?: unknown }} */ (input)
  if (config.schemaVersion !== GOOGLE_WORKSPACE_CONFIG_VERSION) {
    throw new Error(`未対応のGoogle Workspace設定バージョンです: ${String(config.schemaVersion)}`)
  }
  return createGoogleWorkspaceConfig({
    accountEmail: requiredString(config.accountEmail, 'Googleアカウント'),
    clientId: requiredString(config.oauthClientId, 'client_id'),
    clientSecret: requiredString(config.oauthClientSecret, 'client_secret'),
  })
}

/** @param {string} path */
export async function readGoogleWorkspaceConfig(path = resolveGoogleWorkspaceConfigPath()) {
  let raw
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
      throw new Error(`Google Workspaceが未設定です。npm run setup:google を実行してください (${path})`)
    }
    throw error
  }
  try {
    return validateGoogleWorkspaceConfig(JSON.parse(raw))
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`Google Workspace設定JSONが壊れています (${path})`)
    throw error
  }
}

/** @param {ReturnType<typeof createGoogleWorkspaceConfig>} config @param {{ path?: string, force?: boolean }} [options] */
export async function writeGoogleWorkspaceConfig(config, options = {}) {
  const path = options.path || resolveGoogleWorkspaceConfigPath()
  const validated = validateGoogleWorkspaceConfig(config)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(path, `${JSON.stringify(validated, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: options.force ? 'w' : 'wx',
  })
  try { await chmod(path, 0o600) } catch { /* WindowsではユーザープロファイルのACLを使う */ }
  return path
}
