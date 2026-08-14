/**
 * 会議URLの許可リスト(単一の正)。会議自動運転が「開いて録る」対象URLの判定に使う。
 * 依存ゼロ。プロンプト側の抽出指示と食い違わないよう、ホスト一覧はここに集約する。
 *
 * 直リンク(meet/zoom/teams)に加え、就活の面談案内で実際に来る「URL短縮リンク」も
 * 有効な会議URLとして受理する。短縮リンクはボット弾き(curlで403)されるため、
 * 実ブラウザ(Start-Process)で開かせて302リダイレクトを解決させる前提。サーバ側では解決しない。
 */

/** 会議そのものの直リンクホスト(サブドメインも許可: 例 us05web.zoom.us)。 */
export const MEETING_HOSTS = ['meet.google.com', 'zoom.us', 'teams.microsoft.com']

/** 面談案内でよく使われるURL短縮サービス。実ブラウザで開けばMeet等へリダイレクトされる。 */
export const SHORTENER_HOSTS = [
  'weburl.jp', 'bit.ly', 'tinyurl.com', 'x.gd', 'cutt.ly', 'is.gd',
  't.co', 'lnkd.in', 'ur0.cc', 'urx.nu', 'buff.ly', 'rebrand.ly',
]

/** URLのホスト部を小文字化し、先頭の www. を落として返す。解析不能なら空文字。 */
function hostOf(url: string): string {
  try {
    return new URL(url.trim()).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * 会議として「開いて録る」対象URLか。直リンク(サブドメイン含む)または短縮ホストなら true。
 * 空文字・不正URL・上記以外のホストは false。
 */
export function isMeetingUrl(url: string | null | undefined): boolean {
  if (!url) return false
  const host = hostOf(url)
  if (!host) return false
  if (MEETING_HOSTS.some((h) => host === h || host.endsWith('.' + h))) return true
  if (SHORTENER_HOSTS.some((h) => host === h)) return true
  return false
}
