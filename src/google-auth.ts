/**
 * 保存済みの Google OAuth トークン(refresh_token)からアクセストークンを得る。
 *
 * 利用者が自分のGoogle CloudのOAuthクライアントで google:connect（読取り専用）または
 * google-workspace MCP を一度認証すると、`<credentialsDir>/<email>.json` にrefresh_tokenが保存される。
 * 決定的な取得スクリプト(gmail-fetch / calendar-fetch)はそれを再利用するだけ。
 * 秘密値はログへ出さない。ファイルはリポジトリの外(既定 ~/.google_workspace_mcp/credentials)に置く。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

interface StoredToken {
  refresh_token?: string
  client_id?: string
  client_secret?: string
  token_uri?: string
}

export class GoogleAuthError extends Error {}

export const GOOGLE_REFRESH_ENDPOINT = 'https://oauth2.googleapis.com/token'
export const COMMON_GOOGLE_REFRESH_ENDPOINT = 'https://katazuku-google.kotalabo.com/token'

/** 保存ファイルが任意の送信先を指定しても、認証情報は既知の接続先だけへ送る。 */
export function googleRefreshEndpoint(stored: StoredToken): string {
  const endpoint = stored.token_uri || GOOGLE_REFRESH_ENDPOINT
  if (endpoint !== GOOGLE_REFRESH_ENDPOINT && endpoint !== COMMON_GOOGLE_REFRESH_ENDPOINT) {
    throw new GoogleAuthError('保存済みGoogle資格情報の接続先を確認できません。docs/GOOGLE-WORKSPACE.md を参照してください。')
  }
  return endpoint
}

/** 共通接続では秘密鍵をPCへ配らず、旧クライアントの環境変数も使わない。 */
export function hasGoogleRefreshConfiguration(stored: StoredToken, env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    const common = googleRefreshEndpoint(stored) === COMMON_GOOGLE_REFRESH_ENDPOINT
    const present = (value: unknown): boolean => typeof value === 'string' && !!value.trim()
    return present(stored.refresh_token)
      && present(common ? stored.client_id : stored.client_id || env.GOOGLE_OAUTH_CLIENT_ID)
      && (common || present(stored.client_secret || env.GOOGLE_OAUTH_CLIENT_SECRET))
  } catch { return false }
}

export function credentialPath(credentialsDir: string, account: string): string {
  if (!/^[^/\\]+@[^/\\]+$/.test(account)) throw new GoogleAuthError('アカウント表記が不正です。個人設定を確認してください。')
  return join(credentialsDir, `${account}.json`)
}

export async function getGoogleAccessToken(
  account: string,
  credentialsDir: string,
  options: { fetch?: typeof fetch; env?: NodeJS.ProcessEnv } = {},
): Promise<string> {
  const env = options.env ?? process.env
  const request = options.fetch ?? fetch
  const path = credentialPath(credentialsDir, account)
  let stored: StoredToken
  try {
    stored = JSON.parse(readFileSync(path, 'utf8')) as StoredToken
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) throw new Error()
  } catch {
    throw new GoogleAuthError('OAuthトークンを読めません。Google接続と保存先を確認してください。docs/SETUP.md')
  }
  const endpoint = googleRefreshEndpoint(stored)
  const common = endpoint === COMMON_GOOGLE_REFRESH_ENDPOINT
  const clientId = common ? stored.client_id : stored.client_id || env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = common ? undefined : stored.client_secret || env.GOOGLE_OAUTH_CLIENT_SECRET
  if (!hasGoogleRefreshConfiguration(stored, env)) throw new GoogleAuthError('Google接続の更新情報が不足しています。使用している接続方式で再認証してください。docs/SETUP.md')
  const fields = new URLSearchParams({ client_id: clientId!, refresh_token: stored.refresh_token!, grant_type: 'refresh_token' })
  if (clientSecret) fields.set('client_secret', clientSecret)
  const response = await request(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: fields,
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new GoogleAuthError(`アクセストークンの取得に失敗(HTTP ${response.status})。再認証が必要かもしれません`)
  const json = (await response.json()) as { access_token?: string }
  if (typeof json.access_token !== 'string' || !json.access_token.trim()) throw new GoogleAuthError('アクセストークンが応答に含まれていません')
  return json.access_token
}
