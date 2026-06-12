/**
 * Google Identity Services を使ったクライアントサイドのみの認証。
 * バックエンド不要。ユーザー自身の OAuth クライアントID を入力して使う(Inboxと同方式)。
 */

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string
            scope: string
            callback: (resp: { access_token?: string; error?: string }) => void
          }): { requestAccessToken(): void }
        }
      }
    }
  }
}

const GSI_SRC = 'https://accounts.google.com/gsi/client'
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets'

let gsiLoaded: Promise<void> | null = null

function loadGsi(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve()
  if (!gsiLoaded) {
    gsiLoaded = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = GSI_SRC
      s.async = true
      s.onload = () => resolve()
      s.onerror = () => reject(new Error('Google認証スクリプトの読み込みに失敗しました'))
      document.head.appendChild(s)
    })
  }
  return gsiLoaded
}

export async function requestAccessToken(clientId: string): Promise<string> {
  await loadGsi()
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.access_token) resolve(resp.access_token)
        else reject(new Error(resp.error ?? 'アクセスが許可されませんでした'))
      },
    })
    client.requestAccessToken()
  })
}
