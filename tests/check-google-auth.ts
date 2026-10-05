/** 共通接続と個別OAuthの、実際に同期が使うrefresh入口を合成資格情報で検証する。 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { COMMON_GOOGLE_REFRESH_ENDPOINT, GOOGLE_REFRESH_ENDPOINT, getGoogleAccessToken, hasGoogleRefreshConfiguration } from '../src/google-auth.js'
import { checkStoredGoogleReadConnection } from '../src/google-connect.js'

const directory = mkdtempSync(join(tmpdir(), 'katazuku-google-refresh-'))
const account = 'person@example.com'
const path = join(directory, account + '.json')
const common = { client_id: '123-example.apps.googleusercontent.com', client_secret: '', refresh_token: 'example-refresh', token_uri: COMMON_GOOGLE_REFRESH_ENDPOINT }
const oldEnvironment = { GOOGLE_OAUTH_CLIENT_ID: 'old-client', GOOGLE_OAUTH_CLIENT_SECRET: 'old-secret' }
let calls: { url: string; init: RequestInit | undefined }[] = []
const request: typeof fetch = async (input, init) => {
  const url = String(input)
  calls.push({ url, init })
  if (url.endsWith('/token')) return Response.json({ access_token: 'example-access' })
  if (url.endsWith('/userinfo')) return Response.json({ sub: 'example-user', email: account, email_verified: true })
  if (url.endsWith('/profile')) return Response.json({ emailAddress: account })
  if (url.includes('/calendarList')) return Response.json({ kind: 'calendar#calendarList' })
  return Response.json({})
}
try {
  writeFileSync(path, JSON.stringify(common))
  const original = readFileSync(path, 'utf8')
  assert.equal(await getGoogleAccessToken(account, directory, { fetch: request, env: oldEnvironment }), 'example-access')
  assert.equal(calls[0]!.url, COMMON_GOOGLE_REFRESH_ENDPOINT)
  const body = calls[0]!.init!.body as URLSearchParams
  assert.equal(body.get('client_id'), common.client_id)
  assert.equal(body.has('client_secret'), false)
  assert.equal(calls[0]!.init!.redirect, 'error')
  assert.equal(hasGoogleRefreshConfiguration(common, {}), true)
  assert.equal(hasGoogleRefreshConfiguration({ ...common, client_id: '' }, oldEnvironment), false)
  calls = []
  await checkStoredGoogleReadConnection(account, directory, request, oldEnvironment)
  assert.deepEqual(calls.map(call => call.url), [COMMON_GOOGLE_REFRESH_ENDPOINT,
    'https://openidconnect.googleapis.com/v1/userinfo', 'https://gmail.googleapis.com/gmail/v1/users/me/profile',
    'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1'])
  assert.equal(readFileSync(path, 'utf8'), original)
  writeFileSync(path, JSON.stringify({ ...common, client_secret: 'example-secret', token_uri: GOOGLE_REFRESH_ENDPOINT }))
  calls = []
  await getGoogleAccessToken(account, directory, { fetch: request, env: {} })
  assert.equal(calls[0]!.url, GOOGLE_REFRESH_ENDPOINT)
  assert.equal((calls[0]!.init!.body as URLSearchParams).get('client_secret'), 'example-secret')
  for (const endpoint of ['https://outside.example.test/token', COMMON_GOOGLE_REFRESH_ENDPOINT + '?x=1', 'http://katazuku-google.kotalabo.com/token']) {
    writeFileSync(path, JSON.stringify({ ...common, token_uri: endpoint }))
    calls = []
    await assert.rejects(getGoogleAccessToken(account, directory, { fetch: request, env: oldEnvironment }))
    assert.equal(calls.length, 0)
    assert.equal(hasGoogleRefreshConfiguration({ ...common, token_uri: endpoint }), false)
  }
  for (const value of ['null', '[]', '{broken']) {
    writeFileSync(path, value)
    await assert.rejects(getGoogleAccessToken(account, directory, { fetch: request }))
  }
  console.log('Google更新入口: 共通接続の秘密鍵不要・旧設定分離・読取り診断・既存ファイル保持・個別OAuth互換・任意送信先拒否を確認しました。')
} finally { rmSync(directory, { recursive: true, force: true }) }
