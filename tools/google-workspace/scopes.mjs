// 実際のAPI操作に必要な最小範囲(2026-10-07に9→7へ縮小)。
// - calendar.events: 予定の読み取り(events.list)と登録・更新。calendar.readonlyはこれと重複するため要求しない。
// - drive.file: katazukuが作成した、または利用者がkatazukuで開いたファイルだけ。Drive全体の読取(drive.readonly)は要求しない。
// - gmail.modify: 読み取り・下書き・本人確認済み送信・ラベル変更(既読化・ゴミ箱)。
//   gmail.readonlyも制限付きで、messages.modifyはgmail.modifyを要するため、分割しても区分は下がらない。
// Drive全体・カレンダー自体の管理・Gmail設定変更は要求しない。
export const DEFAULT_BROKER_ORIGIN = 'https://katazuku-google.kotalabo.com';
export const GOOGLE_SCOPES = Object.freeze([
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
]);

export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

export function normalizedScopes(value) {
  if (typeof value !== 'string') return [];
  const aliases = { email: 'https://www.googleapis.com/auth/userinfo.email', profile: 'https://www.googleapis.com/auth/userinfo.profile' };
  return [...new Set(value.trim().split(/\s+/).filter(Boolean).map(scope => aliases[scope] || scope))].sort();
}
