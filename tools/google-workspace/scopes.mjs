// 実際のAPI操作に必要な範囲。Drive全体の変更、カレンダー自体の管理、Gmail設定変更は要求しない。
// OSS版は作者の認証サービスへ暗黙接続しない。利用者が管理するHTTPS originを明示する。
export const DEFAULT_BROKER_ORIGIN = process.env.KATAZUKU_GOOGLE_BROKER_ORIGIN || '';
export const GOOGLE_SCOPES = Object.freeze([
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive.readonly',
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
