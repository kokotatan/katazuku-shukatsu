// GUIと毎日のランナーで共用する端末設定。資格情報は公開状態へ含めない。
import { createHash, randomUUID } from 'node:crypto'
import { access, appendFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeAllowedUrlPrefix, validatePortalId } from './lib.mjs'

export const DEFAULT_TIME = '07:40'
export const settingsPath = (root) => join(root, 'logs', 'local-login-settings.local.json')
export const portalsPath = (root) => join(root, 'logs', 'local-login-portals.local.json')
export const profileDirectoryId = (id, portal) => portal.profileVersion ? `${id}-${portal.profileVersion}` : id
export const credentialRecordPath = (root, id, portal) => join(root, 'credential-store', `${profileDirectoryId(id, portal)}.json`)

export class SettingsError extends Error {
  constructor(message, status = 400) { super(message); this.status = status }
}

async function readJsonFile(path, fallback) {
  try { return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, '')) }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error }
}

export async function readPresets(root) {
  const raw = await readJsonFile(join(root, 'scripts', 'local-login', 'portal-presets.json'), { version: 1, presets: [] })
  if (raw.version !== 1 || !Array.isArray(raw.presets)) throw new Error('サービス候補が不正です')
  const seen = new Set()
  return raw.presets.map((preset) => {
    validatePortalId(preset.id)
    if (typeof preset.label !== 'string' || !preset.label.trim() || seen.has(preset.id) ||
        Object.keys(preset).some((key) => !['id', 'label'].includes(key))) throw new Error('サービス候補が不正です')
    seen.add(preset.id)
    return { id: preset.id, label: preset.label }
  })
}

export async function readRegistry(root) {
  const [legacy, local, presets] = await Promise.all([
    readJsonFile(join(root, 'scripts', 'local-login', 'portals.json'), { portals: {} }),
    readJsonFile(portalsPath(root), { portals: {} }),
    readPresets(root),
  ])
  for (const raw of [legacy, local]) {
    if (!raw.portals || typeof raw.portals !== 'object' || Array.isArray(raw.portals)) throw new Error('ポータル設定が不正です')
  }
  return Object.fromEntries(Object.entries({ ...legacy.portals, ...local.portals }).map(([id, portal]) => {
    validatePortalId(id)
    normalizeAllowedUrlPrefix(portal.loginUrl)
    if (typeof portal.label !== 'string' || !portal.label.trim()) throw new Error('ポータル名が不正です')
    if (portal.authMode && !['sso', 'password'].includes(portal.authMode)) throw new Error('認証方式が不正です')
    if (portal.profileVersion && !/^[a-f0-9-]{36}$/.test(portal.profileVersion)) throw new Error('プロファイル設定が不正です')
    if (portal.configuredAt && !Number.isFinite(Date.parse(portal.configuredAt))) throw new Error('設定日時が不正です')
    const preset = presets.find((item) => item.id === (Object.hasOwn(portal, 'presetId') ? portal.presetId : id))
    return [id, {
      label: preset?.label || portal.label, loginUrl: portal.loginUrl, authMode: portal.authMode || 'password',
      presetId: preset?.id || '', profileVersion: portal.profileVersion || '', configuredAt: portal.configuredAt || '',
    }]
  }))
}

export function validatePreferences(value, registry) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some((key) => !['version', 'enabled', 'time', 'portalIds'].includes(key)) ||
      value.version !== 1 || typeof value.enabled !== 'boolean' ||
      typeof value.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time) ||
      !Array.isArray(value.portalIds) || value.portalIds.length > Object.keys(registry).length ||
      value.portalIds.some((id) => typeof id !== 'string' || !Object.hasOwn(registry, id)) ||
      new Set(value.portalIds).size !== value.portalIds.length) {
    throw new SettingsError('設定を確認してください。時刻は00:00〜23:59、対象は登録済みサービスから選びます。')
  }
  if (value.enabled && value.portalIds.length === 0) throw new SettingsError('毎日ログインするサービスを1件以上選んでください。')
  return { version: 1, enabled: value.enabled, time: value.time, portalIds: [...value.portalIds].sort() }
}

async function readSaved(root, registry) {
  try {
    return validatePreferences(JSON.parse((await readFile(settingsPath(root), 'utf8')).replace(/^\uFEFF/, '')), registry)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw new SettingsError('保存済みの自動ログイン設定を読み込めません。設定ファイルを確認してください。', 503)
  }
}

// GUI未使用の端末は従来の対象を維持。設定破損時は全件実行へ戻さず停止する。
export async function scheduledPortalIds(root) {
  const registry = await readRegistry(root)
  const saved = await readSaved(root, registry)
  return saved ? (saved.enabled ? saved.portalIds : []) : Object.keys(registry)
}

export async function atomicWrite(path, contents) {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, contents, { flag: 'wx', mode: 0o600 })
    await rename(temporary, path)
  } finally { await rm(temporary, { force: true }) }
}

const reasons = {
  sso_session_active: 'ログイン状態を確認しました',
  likely_already_authenticated: 'ログイン画面がありません（完了は未確認）',
  sso_session_expired_manual_login_required: '再ログインが必要です',
  sso_redirected_offsite: '再ログインが必要です',
  mfa: '認証コードの入力が必要です',
  captcha: '本人による画像認証が必要です',
  credential_fields_not_unique: 'ログイン欄を特定できません',
  no_credential_record: 'ログイン情報を登録してください',
  profile_locked_by_another_chrome: '専用Chromeを閉じてから再実行してください',
  sign_in_then_close_window: 'ログインしたら専用Chromeを閉じてください',
  disabled_in_settings: '設定により実行しませんでした',
}
const statuses = {
  submitted: 'フォームを送信しました（ログイン完了は未確認）',
  no_login_form: 'ログイン画面がありません（完了は未確認）',
  stopped: '本人の確認が必要です', skipped: '実行を見送りました',
  manual_launched: 'ログイン画面を開きました', error: 'ログインを実行できませんでした',
}

async function latestResults(root, registry) {
  const logDir = join(root, 'logs')
  const files = await readdir(logDir).catch((error) => { if (error.code === 'ENOENT') return []; throw error })
  const latest = {}
  for (const file of files.filter((name) => /^local-login-\d{4}-\d{2}-\d{2}\.log$/.test(name)).sort().reverse().slice(0, 14)) {
    const lines = (await readFile(join(logDir, file), 'utf8')).split('\n').reverse()
    for (const line of lines) {
      try {
        const row = JSON.parse(line)
        if (!Object.hasOwn(registry, row.portalId) || latest[row.portalId] || !Object.hasOwn(statuses, row.status) ||
            typeof row.ts !== 'string' || !Number.isFinite(Date.parse(row.ts))) continue
        if (registry[row.portalId].configuredAt && Date.parse(row.ts) < Date.parse(registry[row.portalId].configuredAt)) continue
        // 例外文字列や生のログをブラウザへ返さない。
        latest[row.portalId] = {
          at: new Date(row.ts).toISOString(), status: row.status,
          message: Object.hasOwn(reasons, row.reason) ? reasons[row.reason] : statuses[row.status],
        }
      } catch { /* 書き込み途中の行は次回更新で読む。 */ }
    }
  }
  return latest
}

export function createSettingsService({ root, readSchedule, applySchedule, storeCredential, openLogin, machine = hostname() }) {
  async function current() {
    const [registry, schedule] = await Promise.all([readRegistry(root), readSchedule()])
    const saved = await readSaved(root, registry)
    const preferences = saved ?? {
      version: 1, enabled: schedule.enabled && Object.keys(registry).length > 0,
      time: schedule.time || DEFAULT_TIME, portalIds: Object.keys(registry).sort(),
    }
    const revision = createHash('sha256').update(JSON.stringify({ preferences, schedule, registry })).digest('hex')
    return { registry, preferences, schedule, revision }
  }
  async function audit(action, how) {
    await mkdir(join(root, 'logs'), { recursive: true })
    await appendFile(join(root, 'logs', 'activity-log.jsonl'), JSON.stringify({
      ts: new Date().toISOString(), by: 'local-login-settings', action,
      why: '本人がGUIから自動ログインを設定するため', how, result: '成功',
    }) + '\n', 'utf8')
  }
  async function state() {
    const { registry, ...result } = await current()
    const latest = await latestResults(root, registry)
    const portals = await Promise.all(Object.entries(registry).map(async ([id, portal]) => ({
      id, ...portal,
      credentialStored: await access(credentialRecordPath(root, id, portal)).then(() => true, (error) => {
        if (error.code === 'ENOENT') return false
        throw error
      }),
      lastResult: latest[id] || null,
    })))
    return { ...result, portals, presets: await readPresets(root), machine, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }
  }
  return {
    state,
    async configure(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SettingsError('サービスの設定を確認してください。')
      const before = await current()
      if (value.revision !== before.revision) throw new SettingsError('サービスの設定が変わりました。再読み込みしてから設定してください。', 409)
      if (Object.keys(value).some((key) => !['id', 'presetId', 'label', 'loginUrl', 'authMode', 'revision'].includes(key)) ||
          typeof value.presetId !== 'string' || typeof value.label !== 'string' || typeof value.loginUrl !== 'string' ||
          (value.id !== undefined && typeof value.id !== 'string') ||
          !['sso', 'password'].includes(value.authMode)) throw new SettingsError('サービス名・ログインURL・認証方法を確認してください。')
      const preset = (await readPresets(root)).find((item) => item.id === value.presetId)
      if (value.presetId && !preset) throw new SettingsError('サービスを選択してください。')
      const label = preset?.label || value.label.trim()
      if (!label || label.length > 100 || /[\u0000-\u001f]/.test(label)) throw new SettingsError('サービス名を100文字以内で入力してください。')
      const loginUrl = value.loginUrl.trim()
      try {
        if (!loginUrl || loginUrl.length > 2048) throw new Error()
        normalizeAllowedUrlPrefix(loginUrl)
      } catch { throw new SettingsError('ログインURLはHTTPSで入力してください。認証コード・クエリ・#を含むURLは使えません。') }
      const old = value.id ? before.registry[value.id] : null
      if (value.id && !Object.hasOwn(before.registry, value.id)) throw new SettingsError('登録済みのサービスを選んでください。')
      const id = value.id || preset?.id || `custom-${randomUUID()}`
      if (!value.id && Object.hasOwn(before.registry, id)) throw new SettingsError('このサービスは登録済みです。一覧の「接続先を変更」から設定してください。', 409)
      if (preset && Object.entries(before.registry).some(([key, portal]) => key !== id && portal.presetId === preset.id)) {
        throw new SettingsError('このサービスは登録済みです。一覧から接続先を変更してください。', 409)
      }
      const changed = !old || old.loginUrl !== loginUrl || old.authMode !== value.authMode
      const registry = { ...before.registry, [id]: {
        label, loginUrl, authMode: value.authMode, presetId: preset?.id || '',
        profileVersion: changed ? randomUUID() : old.profileVersion,
        configuredAt: changed ? new Date().toISOString() : old.configuredAt,
      } }
      await mkdir(join(root, 'logs'), { recursive: true })
      const path = settingsPath(root)
      const previous = await readFile(path).catch((error) => { if (error.code === 'ENOENT') return null; throw error })
      // 初回の旧設定を固定し、サービスの追加だけでは自動実行の対象を増やさない。
      await atomicWrite(path, JSON.stringify(before.preferences, null, 2) + '\n')
      try { await atomicWrite(portalsPath(root), JSON.stringify({ version: 1, portals: registry }, null, 2) + '\n') }
      catch (error) {
        if (previous) await atomicWrite(path, previous)
        else await rm(path, { force: true })
        throw error
      }
      await audit('自動ログインの接続先を設定', `サービス: ${id} / ${old ? '変更' : '追加'} / 本人がURL・認証方法を設定`)
      return { state: await state(), reauthenticationRequired: changed }
    },
    async save({ preferences, revision }) {
      const before = await current()
      if (revision !== before.revision) throw new SettingsError('別の画面で設定が変わりました。「再読み込み」で最新の設定を確認してください。', 409)
      const checked = validatePreferences(preferences, before.registry)
      await mkdir(join(root, 'logs'), { recursive: true })
      const path = settingsPath(root)
      const previous = await readFile(path).catch((error) => { if (error.code === 'ENOENT') return null; throw error })
      await atomicWrite(path, JSON.stringify(checked, null, 2) + '\n')
      try { await applySchedule(checked) }
      catch {
        if (previous) await atomicWrite(path, previous)
        else await rm(path, { force: true })
        throw new SettingsError('Windowsの実行予約を更新できませんでした。設定は保存されていません。タスクの権限を確認してください。', 503)
      }
      await audit('自動ログイン設定を保存', `${checked.enabled ? '有効' : '停止'} / ${checked.time} / 対象${checked.portalIds.length}件`)
      return state()
    },
    async credentials(id, value) {
      const { registry, revision } = await current()
      if (value?.revision !== revision) throw new SettingsError('ログイン先が変更された可能性があります。再読み込みしてから登録してください。', 409)
      if (!Object.hasOwn(registry, id) || registry[id].authMode === 'sso') throw new SettingsError('ログイン情報を登録できるサービスを選んでください。')
      if (!value || typeof value.username !== 'string' || typeof value.password !== 'string' ||
          !value.username.trim() || !value.password || value.username.length > 1024 || value.password.length > 4096 ||
          /[\r\n\0]/.test(value.username + value.password) || Object.keys(value).some((key) => !['username', 'password', 'revision'].includes(key))) {
        throw new SettingsError('ログインIDとパスワードを入力してください。改行は使用できません。')
      }
      try { await storeCredential(id, registry[id].loginUrl, value, registry[id]) }
      finally { value.username = ''; value.password = '' }
      await audit('自動ログインの認証情報を登録', `サービス: ${id} / このWindowsユーザー用に暗号化`)
      return { stored: true }
    },
    async login(id, value) {
      const { registry, revision } = await current()
      if (value?.revision !== revision) throw new SettingsError('ログイン先が変更された可能性があります。再読み込みしてから開いてください。', 409)
      if (!Object.hasOwn(registry, id)) throw new SettingsError('登録済みのサービスを選んでください。')
      await openLogin(id)
      await audit('本人操作用のログイン画面を起動', `サービス: ${id} / 専用Chrome`)
      return { opened: true }
    },
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.slice(2).join(' ') !== '--scheduled-portals') throw new Error('引数が不正です')
  process.stdout.write(JSON.stringify(await scheduledPortalIds(fileURLToPath(new URL('../..', import.meta.url)))))
}
