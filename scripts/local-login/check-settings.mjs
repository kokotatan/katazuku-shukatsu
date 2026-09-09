// 合成設定だけで検証する。実際のWindowsタスクと実サイトは変更・起動しない。
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { request as httpRequest } from 'node:http'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createSettingsService, readRegistry, readPresets, credentialRecordPath, profileDirectoryId, scheduledPortalIds, settingsPath, validatePreferences } from './settings.mjs'
import { startSettingsServer } from './settings-server.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const testParent = resolve(repoRoot, 'logs')
await mkdir(testParent, { recursive: true })
const fixtureRoot = await mkdtemp(join(testParent, 'local-login-settings-check-'))
let checks = 0
function ok(value, message) { assert.ok(value, message); checks += 1 }
async function rejects(operation, pattern = /./) { await assert.rejects(operation, pattern); checks += 1 }
let server

try {
  await mkdir(join(fixtureRoot, 'scripts', 'local-login'), { recursive: true })
  await mkdir(join(fixtureRoot, 'logs'), { recursive: true })
  const portalFile = join(fixtureRoot, 'scripts', 'local-login', 'portals.json')
  const catalogFile = join(fixtureRoot, 'scripts', 'local-login', 'portal-presets.json')
  const catalog = JSON.stringify({ version: 1, presets: [{ id: 'synth-preset', label: '合成プリセット' }] })
  await writeFile(catalogFile, catalog)
  await writeFile(portalFile, JSON.stringify({ portals: {
    sso: { label: '合成SSO', loginUrl: 'https://sso.example.test/login', authMode: 'sso', note: '公開状態に含めないメモ' },
    password: { label: '合成採用サービス', loginUrl: 'https://ats.example.test/team/login' },
  } }))
  const registry = await readRegistry(fixtureRoot)
  const prefs = { version: 1, enabled: true, time: '08:25', portalIds: ['password'] }
  for (const invalid of [
    null, [], { ...prefs, version: 2 }, { ...prefs, enabled: 'true' }, { ...prefs, time: '24:00' },
    { ...prefs, time: '08:60' }, { ...prefs, time: '8:25' }, { ...prefs, time: '08:25; whoami' },
    { ...prefs, portalIds: [] }, { ...prefs, portalIds: ['password', 'password'] },
    { ...prefs, portalIds: ['../secret'] }, { ...prefs, portalIds: ['toString'] },
    { ...prefs, command: 'whoami' },
  ]) { assert.throws(() => validatePreferences(invalid, registry)); checks += 1 }
  ok((await scheduledPortalIds(fixtureRoot)).length === 2, '設定未作成なら既存ランナーの対象を維持する')

  let schedule = { registered: true, enabled: false, time: '07:40', state: 'Disabled' }
  let failSchedule = false
  let failCredential = false
  let stored = null
  let opened = null
  const service = createSettingsService({
    root: fixtureRoot, machine: '合成Windows-PC',
    readSchedule: async () => ({ ...schedule }),
    applySchedule: async (next) => {
      if (failSchedule) throw new Error('合成のタスク権限エラー')
      schedule = { registered: true, enabled: next.enabled, time: next.time, state: next.enabled ? 'Ready' : 'Disabled' }
    },
    storeCredential: async (id, url, value) => {
      if (failCredential) throw new Error('秘密の例外 fixture-password')
      stored = { id, url, value: { ...value } }
    },
    openLogin: async (id) => { opened = id },
  })
  let state = await service.state()
  ok(!state.preferences.enabled && state.preferences.time === '07:40', '既存の停止中タスクを勝手に有効化しない')
  ok(!JSON.stringify(state).includes('公開状態に含めないメモ'), 'レジストリの自由記述メモを公開しない')
  failSchedule = true
  await rejects(() => service.save({ preferences: prefs, revision: state.revision }), /保存されていません/)
  await rejects(() => readFile(settingsPath(fixtureRoot)), /ENOENT/)
  failSchedule = false
  state = await service.save({ preferences: prefs, revision: state.revision })
  ok(state.preferences.time === '08:25' && state.schedule.enabled, '設定とWindows予約へ同じ時刻・有効状態を反映する')
  assert.deepEqual(await scheduledPortalIds(fixtureRoot), ['password']); checks += 1
  await rejects(() => service.save({ preferences: prefs, revision: 'old' }), /別の画面/)
  const before = await readFile(settingsPath(fixtureRoot), 'utf8')
  failSchedule = true
  await rejects(() => service.save({ preferences: { ...prefs, time: '10:00' }, revision: state.revision }), /保存されていません/)
  ok(await readFile(settingsPath(fixtureRoot), 'utf8') === before, '予約失敗時は元の保存済み設定へ戻す')
  failSchedule = false
  state = await service.save({ preferences: { ...prefs, enabled: false }, revision: state.revision })
  assert.deepEqual(await scheduledPortalIds(fixtureRoot), []); checks += 1
  await writeFile(settingsPath(fixtureRoot), '{broken')
  await rejects(() => scheduledPortalIds(fixtureRoot), /読み込めません/)
  await writeFile(settingsPath(fixtureRoot), JSON.stringify(state.preferences))

  const logPath = join(fixtureRoot, 'logs', 'local-login-2026-09-08.log')
  await writeFile(logPath, JSON.stringify({ ts: '2026-09-08T00:00:00Z', portalId: 'password', status: 'error', reason: 'fixture-password', username: 'fixture-user' }) + '\n{incomplete')
  state = await service.state()
  ok(state.portals[1].lastResult.message === 'ログインを実行できませんでした', '例外は固定メッセージへ変換する')
  ok(!JSON.stringify(state).includes('fixture-password') && !JSON.stringify(state).includes('fixture-user'), '状態APIへログ中の秘密値を返さない')

  const assetDir = join(fixtureRoot, 'assets')
  await mkdir(assetDir, { recursive: true })
  await writeFile(join(assetDir, 'index.html'), '<html lang="ja">合成設定画面</html>')
  const running = await startSettingsServer({ service, port: 0, assetsRoot: assetDir })
  server = running.server
  const base = running.origin
  const bootstrap = await fetch(`${base}/api/local-login/session`).then((response) => response.json())
  ok(bootstrap.service === 'katazuku-local-login' && bootstrap.token.length === 64, '端末内の起動セッションを発行する')
  const headers = { Origin: base, 'Content-Type': 'application/json', 'X-Katazuku-Token': bootstrap.token }
  const post = (path, body, override = {}) => fetch(`${base}/api/local-login/${path}`, { method: 'POST', headers: { ...headers, ...override }, body: JSON.stringify(body) })
  ok((await fetch(`${base}/api/local-login/state`)).status === 401, '状態APIはトークン必須')
  ok((await fetch(`${base}/api/local-login/session`, { headers: { Origin: 'https://outside.example.test' } })).status === 403, '外部originからトークンを取得できない')
  ok((await fetch(`${base}/api/local-login/session`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status === 403, '外部サイト経由のAPIアクセスを拒否する')
  const reboundStatus = await new Promise((done, reject) => {
    const request = httpRequest(`${base}/api/local-login/session`, { headers: { Host: `outside.example.test:${server.address().port}` } }, (response) => {
      response.resume(); response.on('end', () => done(response.statusCode))
    })
    request.on('error', reject); request.end()
  })
  ok(reboundStatus === 403, 'DNS rebindingのHostを拒否する')
  ok((await post('settings', { preferences: prefs, revision: state.revision }, { Origin: 'https://outside.example.test' })).status === 403, '外部サイトから設定変更できない')
  ok((await post('settings', { preferences: prefs, revision: state.revision }, { 'Content-Type': 'text/plain' })).status === 415, 'フォームによるCSRFを拒否する')
  ok((await fetch(`${base}/api/local-login/settings`, { method: 'POST', headers: { 'X-Katazuku-Token': bootstrap.token, 'Content-Type': 'application/json' }, body: '{}' })).status === 403, '変更には同一originヘッダーが必要')
  const savedResponse = await post('settings', { preferences: prefs, revision: state.revision })
  ok(savedResponse.status === 200, '同一origin・有効トークンで保存できる')
  state = await savedResponse.json()
  assert.deepEqual(await scheduledPortalIds(fixtureRoot), ['password']); checks += 1
  ok((await post('settings', { preferences: prefs, revision: 'stale' })).status === 409, '別画面の古い設定で上書きしない')
  ok((await post('portals/unknown/login', { revision: state.revision })).status === 400 && opened === null, '未知サービスはChromeを起動しない')
  ok((await post('portals/password/login', { url: 'https://outside.example.test' })).status === 400, 'GUIから任意URLを起動できない')
  ok((await post('portals/password/login', { revision: state.revision })).status === 200 && opened === 'password', '登録済みサービスの本人ログインを起動できる')
  ok((await post('portals/sso/credentials', { username: 'fixture', password: 'fixture', revision: state.revision })).status === 400, 'SSOのパスワード登録を拒否する')
  ok((await post('portals/password/credentials', { username: 'fixture\ninjected', password: 'fixture', revision: state.revision })).status === 400, '標準入力へ行を注入できない')
  ok((await post('portals/password/credentials', { username: '合成ユーザー', password: 'fixture-password', revision: state.revision })).status === 200, '日本語のIDを登録できる')
  ok(stored.url === registry.password.loginUrl && stored.value.username === '合成ユーザー', '保存時のoriginとパスは登録済みURLから導出する')
  const secretValue = { username: 'fixture-user', password: 'fixture-password', revision: state.revision }
  await service.credentials('password', secretValue)
  ok(secretValue.username === '' && secretValue.password === '', '処理後の秘密値を参照から除去する')
  failCredential = true
  const failed = await post('portals/password/credentials', { username: 'fixture', password: 'fixture', revision: state.revision })
  ok(failed.status === 503 && !(await failed.text()).includes('fixture-password'), '子プロセスの例外へ秘密値があってもHTTPへ漏れない')
  const activity = await readFile(join(fixtureRoot, 'logs', 'activity-log.jsonl'), 'utf8')
  ok(activity.includes('自動ログイン設定を保存') && !activity.includes('fixture-password') && !activity.includes('fixture-user'), '活動ログは記録し、秘密値は記録しない')
  const page = await fetch(`${base}/board/local-login/`)
  ok(page.status === 200 && page.headers.get('cache-control') === 'no-store' && page.headers.get('x-frame-options') === 'DENY', '設定画面はキャッシュ・埋め込みを禁止する')
  ok((await fetch(`${base}/credential-store/password.json`)).status === 404, '資格情報ファイルを静的配信しない')
  ok((await fetch(`${base}/board/assets/../../logs/activity-log.jsonl`)).status === 404, 'パス操作でログを読み出せない')

  const configure = { presetId: 'synth-preset', label: '', loginUrl: 'https://portal.example.test/login', authMode: 'sso', revision: state.revision }
  for (const loginUrl of ['', 'http://portal.example.test/', 'javascript:alert(1)', 'https://user:password@portal.example.test/', 'https://portal.example.test/?code=secret', 'https://portal.example.test/#secret']) {
    ok((await post('portals', { ...configure, loginUrl })).status === 400, '未入力・非HTTPS・一時認証URLを登録しない')
  }
  ok((await post('portals', { ...configure, presetId: 'unknown' })).status === 400, '存在しないプリセットを受け付けない')
  const configuredResponse = await post('portals', configure)
  ok(configuredResponse.status === 200, '本人がURLを設定してサービスを追加できる')
  state = (await configuredResponse.json()).state
  const added = state.portals.find((portal) => portal.id === 'synth-preset')
  ok(added.label === '合成プリセット' && added.loginUrl === configure.loginUrl, 'プリセットは正式名称だけを供給し、本人のURLを保存する')
  assert.deepEqual(await scheduledPortalIds(fixtureRoot), ['password']); checks += 1
  ok(await readFile(catalogFile, 'utf8') === catalog, '本人のURLを配布用カタログへ書かない')
  ok((await post('portals', { ...configure, revision: state.revision })).status === 409, '同じプリセットを誤って二重登録しない')
  const customResponse = await post('portals', { ...configure, presetId: '', label: '合成の企業マイページ', revision: state.revision })
  ok(customResponse.status === 200, '候補にないサービスを自由入力できる')
  state = (await customResponse.json()).state
  const oldRevision = state.revision
  const oldPortal = (await readRegistry(fixtureRoot)).password
  const oldCredentialPath = credentialRecordPath(fixtureRoot, 'password', oldPortal)
  await mkdir(join(fixtureRoot, 'credential-store'), { recursive: true })
  await writeFile(oldCredentialPath, '{"fixture":true}')
  const changedResponse = await post('portals', { id: 'password', presetId: '', label: oldPortal.label, loginUrl: 'https://ats.example.test/another/login', authMode: 'password', revision: oldRevision })
  ok(changedResponse.status === 200, '登録後にURL・認証方法を編集できる')
  const changed = await changedResponse.json()
  state = changed.state
  const newPortal = (await readRegistry(fixtureRoot)).password
  ok(changed.reauthenticationRequired && !state.portals.find((portal) => portal.id === 'password').credentialStored, '接続先変更後は旧認証情報を自動で使わない')
  ok(credentialRecordPath(fixtureRoot, 'password', newPortal) !== oldCredentialPath && profileDirectoryId('password', oldPortal) !== profileDirectoryId('password', newPortal), '接続先変更後の認証情報・セッションを分離する')
  ok((await readFile(oldCredentialPath, 'utf8')).includes('fixture'), '旧認証情報は削除せず再利用を止める')
  ok((await post('portals/password/credentials', { username: 'fixture', password: 'fixture', revision: oldRevision })).status === 409, '古い画面の認証情報を変更後のURLに登録しない')
  ok((await post('portals/password/login', { revision: oldRevision })).status === 409, '古い画面から変更後のURLを開かない')
  ok((await post('settings', { preferences: state.preferences, revision: oldRevision })).status === 409, '接続先変更も設定の競合検査に含める')
  const shippedPresets = await readPresets(repoRoot)
  ok(shippedPresets.length >= 6 && shippedPresets.every((preset) => Object.keys(preset).every((key) => ['id', 'label'].includes(key))), '配布する選択肢にログインURL・認証情報を含めない')
  const shippedRegistry = JSON.parse(await readFile(join(here, 'portals.json'), 'utf8'))
  ok(Object.keys(shippedRegistry.portals).length === 0, '配布時のログイン先は空にする')
  const emptyRoot = join(fixtureRoot, 'empty-install')
  await mkdir(join(emptyRoot, 'scripts', 'local-login'), { recursive: true })
  await writeFile(join(emptyRoot, 'scripts', 'local-login', 'portal-presets.json'), catalog)
  const emptyService = createSettingsService({
    root: emptyRoot, machine: '合成Windows-PC',
    readSchedule: async () => ({ registered: true, enabled: true, time: '07:40', state: 'Ready' }),
    applySchedule: async () => { throw new Error('サービス追加だけではタスクを変更しない') },
  })
  const emptyState = await emptyService.state()
  ok(emptyState.portals.length === 0 && !emptyState.preferences.enabled, '新規導入時はサービスなし・停止で始める')
  const firstAdded = await emptyService.configure({ presetId: 'synth-preset', label: '', loginUrl: 'https://login.example.test/', authMode: 'sso', revision: emptyState.revision })
  ok(firstAdded.state.portals.length === 1 && !firstAdded.state.preferences.enabled && firstAdded.state.preferences.portalIds.length === 0,
    '初回追加後も選択・有効化されず、設定を再読込できる')

  if (process.platform === 'win32') {
    const scheduleChecks = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(here, 'check-settings-schedule.ps1')], { windowsHide: true, encoding: 'utf8' })
    process.stdout.write(scheduleChecks.stdout)
    const recordPath = join(fixtureRoot, 'fixture.dpapi.json')
    const username = '合成ユーザー@example.test'
    const password = '合成-$()`-password-42'
    await new Promise((resolveRun, rejectRun) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(here, 'store-credential.ps1'),
        '-PortalId', 'password', '-AllowedUrl', registry.password.loginUrl, '-OutputPath', recordPath, '-ReadFromStdin'],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
      let stdout = ''; let stderr = ''
      child.stdout.on('data', (chunk) => { stdout += chunk })
      child.stderr.on('data', (chunk) => { stderr += chunk })
      child.once('error', rejectRun)
      child.once('close', (code) => {
        if (code !== 0) { rejectRun(new Error('合成DPAPIの登録に失敗')); return }
        ok(!stdout.includes(password) && !stderr.includes(password), 'DPAPI登録の標準出力・例外にパスワードがない')
        resolveRun()
      })
      child.stdin.end(`${username}\n${password}\n`, 'utf8')
    })
    const recordText = (await readFile(recordPath, 'utf8')).replace(/^\uFEFF/, '')
    const record = JSON.parse(recordText)
    ok(record.allowedPathPrefix === 'https://ats.example.test/team/', '共有ATSのテナントパスに資格情報を限定する')
    ok(!recordText.includes(password) && !recordText.includes(username), 'ファイルに合成資格情報の平文がない')
    const decrypted = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(here, 'unprotect-credential.ps1'), '-CredentialPath', recordPath], { windowsHide: true, encoding: 'utf8' })
    const plain = JSON.parse(decrypted.stdout.replace(/^\uFEFF/, ''))
    ok(plain.username === username && plain.password === password, '標準入力経由の日本語・記号をDPAPIで往復できる')
    plain.username = ''; plain.password = ''; decrypted.stdout = ''
  }
  console.log(`自動ログインGUI: ${checks}項目成功（合成設定のみ・実タスク変更なし）`)
} finally {
  if (server) await new Promise((done) => { server.close(done); server.closeAllConnections() })
  // Windowsで再帰削除する前に、今回作成したlogs直下の試験フォルダだけと確認する。
  const target = resolve(fixtureRoot)
  if (!target.startsWith(testParent + sep) || !target.split(sep).at(-1).startsWith('local-login-settings-check-')) throw new Error('試験フォルダの範囲が不正です')
  await rm(target, { recursive: true, force: true })
}
