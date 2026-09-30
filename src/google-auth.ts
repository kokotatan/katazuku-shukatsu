/**
 * 保存済みの Google OAuth トークン(refresh_token)からアクセストークンを得る。
 *
 * katazuku 自身はログイン画面を持たない。利用者が「自分の Google Cloud の OAuth クライアント」で
 * google-workspace MCP(workspace-mcp)を一度認証すると、`<credentialsDir>/<email>.json` に
 * refresh_token が保存される。決定的な取得スクリプト(gmail-fetch / calendar-fetch)はそれを再利用するだけ。
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

export function credentialPath(credentialsDir: string, account: string): string {
  if (!/^[^/\\]+@[^/\\]+$/.test(account)) throw new GoogleAuthError(`アカウント表記が不正です: ${account}`)
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
  } catch {
    throw new GoogleAuthError(`OAuthトークンを読めません: ${path}(google-workspace MCP で一度認証してください。docs/SETUP.md)`)
  }
  const clientId = stored.client_id || env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = stored.client_secret || env.GOOGLE_OAUTH_CLIENT_SECRET
  if (!stored.refresh_token) throw new GoogleAuthError('refresh_token がありません。再認証が必要です')
  if (!clientId || !clientSecret) throw new GoogleAuthError('OAuth クライアントIDまたはシークレットがありません(.env の GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET)')
  const response = await request(stored.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: stored.refresh_token,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new GoogleAuthError(`アクセストークンの取得に失敗(HTTP ${response.status})。再認証が必要かもしれません`)
  const json = (await response.json()) as { access_token?: string }
  if (!json.access_token) throw new GoogleAuthError('アクセストークンが応答に含まれていません')
  return json.access_token
}
