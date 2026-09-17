import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const PORTAL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost'])

const PAGE_SUMMARY_EXPRESSION = String.raw`(() => {
  const visible = (element) => {
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
  }
  const text = (value, limit = 160) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit)
  const labelOf = (element) => {
    if (element.labels && element.labels.length) return text(Array.from(element.labels).map((label) => label.innerText).join(' '))
    const ariaLabel = element.getAttribute('aria-label')
    if (ariaLabel) return text(ariaLabel)
    const labelledBy = element.getAttribute('aria-labelledby')
    if (labelledBy) return text(labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.innerText).join(' '))
    return ''
  }
  const fields = Array.from(document.querySelectorAll('input, textarea, select'))
    .filter((element) => visible(element) && !['hidden', 'submit', 'button', 'reset', 'image'].includes((element.type || '').toLowerCase()))
    .map((element, index) => ({
      element: index + 1,
      tag: element.tagName.toLowerCase(),
      type: text((element.type || element.tagName).toLowerCase(), 40),
      name: text(element.getAttribute('name'), 120),
      id: text(element.id, 120),
      autocomplete: text(element.getAttribute('autocomplete'), 80),
      label: labelOf(element),
      placeholder: text(element.getAttribute('placeholder'), 160),
      required: Boolean(element.required),
      disabled: Boolean(element.disabled)
    }))
  const controls = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"]'))
    .filter(visible)
    .map((element, index) => ({
      element: index + 1,
      tag: element.tagName.toLowerCase(),
      type: text((element.type || 'button').toLowerCase(), 40),
      id: text(element.id, 120),
      name: text(element.getAttribute('name'), 120),
      label: text(element.innerText || element.value || element.getAttribute('aria-label'), 160),
      disabled: Boolean(element.disabled)
    }))
  const bodyText = text(document.body?.innerText, 6000)
  const blockers = []
  if (document.querySelector('iframe[src*="captcha" i], [class*="captcha" i], [id*="captcha" i], .g-recaptcha, [data-sitekey]') || /captcha|ロボットではない|私はロボットではありません/i.test(bodyText)) blockers.push('captcha')
  if (document.querySelector('input[autocomplete="one-time-code"]') || /ワンタイム|認証コード|確認コード|verification code|two[- ]factor|multi[- ]factor|\bmfa\b/i.test(bodyText)) blockers.push('mfa')
  return {
    origin: location.origin,
    title: text(document.title, 200),
    blockers: Array.from(new Set(blockers)),
    fields,
    controls
  }
})()`

export function validatePortalId(portalId) {
  if (!PORTAL_ID_PATTERN.test(String(portalId || ''))) {
    throw new Error('portal_idは英数字、ピリオド、ハイフン、アンダースコアの64文字以内で指定してください')
  }
  return portalId
}

export function normalizeAllowedOrigin(value, { allowLoopbackHttp = false } = {}) {
  const url = new URL(value)
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error('allowed_originはパスを含まないorigin形式で指定してください')
  }
  const loopbackHttp = allowLoopbackHttp && url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)
  if (url.protocol !== 'https:' && !loopbackHttp) throw new Error('allowed_originはHTTPSで指定してください')
  return url.origin
}

/**
 * 許可URLプレフィックス(origin + テナントパス)を正規化する。
 * 採用ATSは1ホストに複数企業が同居する(例: ats.example.com に複数の採用企業、
 * 別の共有ホストにも複数テナント)。origin一致だけでは別企業のログイン画面と区別できず、
 * 誤った企業の資格情報を入力してしまう。そこで適用範囲をパスまで絞る。
 * 末尾のファイル名は落としてディレクトリ境界にそろえる(/a/b/logon.html -> /a/b/)。
 * クエリ・ハッシュ・URL内認証情報は許可しない。
 */
export function normalizeAllowedUrlPrefix(value, { allowLoopbackHttp = false } = {}) {
  const url = new URL(value)
  if (url.search || url.hash || url.username || url.password) {
    throw new Error('許可URLプレフィックスにクエリ・ハッシュ・認証情報を含めないでください')
  }
  const loopbackHttp = allowLoopbackHttp && url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)
  if (url.protocol !== 'https:' && !loopbackHttp) throw new Error('許可URLプレフィックスはHTTPSで指定してください')
  const path = url.pathname.endsWith('/')
    ? url.pathname
    : url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1)
  return url.origin + path
}

/** 対象URLが許可プレフィックスの配下か。プレフィックス未設定(専用ホスト)ならorigin一致だけで判定する。 */
export function urlWithinAllowedScope(rawUrl, allowedOrigin, allowedPathPrefix) {
  let url
  try { url = new URL(rawUrl) } catch { return false }
  if (url.origin !== allowedOrigin) return false
  if (!allowedPathPrefix) return true
  return `${url.origin}${url.pathname}`.startsWith(allowedPathPrefix)
}

function boundedText(value, limit) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit)
}

export function sanitizePageSummary(raw) {
  const origin = new URL(raw?.origin).origin
  const fields = Array.isArray(raw?.fields) ? raw.fields.slice(0, 80).map((field, index) => ({
    element: index + 1,
    tag: boundedText(field?.tag, 20),
    type: boundedText(field?.type, 40).toLowerCase(),
    name: boundedText(field?.name, 120),
    id: boundedText(field?.id, 120),
    autocomplete: boundedText(field?.autocomplete, 80).toLowerCase(),
    label: boundedText(field?.label, 160),
    placeholder: boundedText(field?.placeholder, 160),
    required: Boolean(field?.required),
    disabled: Boolean(field?.disabled)
  })) : []
  const controls = Array.isArray(raw?.controls) ? raw.controls.slice(0, 40).map((control, index) => ({
    element: index + 1,
    tag: boundedText(control?.tag, 20),
    type: boundedText(control?.type, 40).toLowerCase(),
    id: boundedText(control?.id, 120),
    name: boundedText(control?.name, 120),
    label: boundedText(control?.label, 160),
    disabled: Boolean(control?.disabled)
  })) : []
  const blockers = Array.isArray(raw?.blockers)
    ? [...new Set(raw.blockers.map((value) => boundedText(value, 40)).filter(Boolean))]
    : []
  return { origin, title: boundedText(raw?.title, 200), blockers, fields, controls }
}

function fieldMatches(field, pattern) {
  return pattern.test([field.label, field.name, field.id, field.placeholder, field.autocomplete].join(' '))
}

function credentialCandidates(summary) {
  const typedUsernames = summary.fields.filter((field) =>
    !field.disabled && ['text', 'email', 'tel'].includes(field.type)
  )
  const recognizedUsernames = typedUsernames.filter((field) =>
    !field.disabled && ['text', 'email', 'tel'].includes(field.type) &&
    (field.autocomplete === 'username' || field.autocomplete === 'email' ||
      fieldMatches(field, /メール|mail|email|ログイン|login|user|ユーザー|会員id|account/i))
  )
  const passwords = summary.fields.filter((field) => !field.disabled && field.type === 'password')
  // i-web等はlabel/autocompleteを持たず、name="gksid"のような裸の属性しか出さない。
  // 認識済み候補が0件でも、入力可能なID型欄とpassword欄が各1件だけなら、その組に限定する。
  // ID型欄が複数ある場合は従来どおり曖昧として停止する。
  const usernames = recognizedUsernames.length === 0 && typedUsernames.length === 1 && passwords.length === 1
    ? typedUsernames
    : recognizedUsernames
  const submits = summary.controls.filter((control) =>
    !control.disabled && (control.type === 'submit' || /ログイン|login|sign in|次へ|continue/i.test(control.label))
  )
  return { usernames, passwords, submits }
}

/**
 * SSOポータル(Googleログイン等)のセッション状態を現在URLだけで判定する。
 * 自前のパスワード欄が存在しないため、フォームの有無では既ログインを判定できない。
 * セッションが生きていればログインページはアプリ本体へ抜ける、という挙動だけを根拠にする。
 * - active: ログインページから離れた(セッション有効)
 * - needs_login: ログインページに留まっている(本人の再ログインが必要)
 * - offsite: 別originへ出た(IdPへ飛ばされた等。入力はせず停止する)
 */
export function classifySsoSessionState(currentUrl, loginUrl) {
  let current
  let login
  try {
    current = new URL(currentUrl)
    login = new URL(loginUrl)
  } catch {
    return 'offsite'
  }
  if (current.origin !== login.origin) return 'offsite'
  const stripTrailingSlash = (path) => path.replace(/\/+$/, '')
  const loginPath = stripTrailingSlash(login.pathname)
  const currentPath = stripTrailingSlash(current.pathname)
  if (currentPath === loginPath || currentPath.startsWith(`${loginPath}/`)) return 'needs_login'
  return 'active'
}

export function analyzeDeterministically(summary, portalId) {
  if (summary.blockers.length) return { action: 'stop', portal_id: portalId, reason: summary.blockers.join(',') }
  const { usernames, passwords, submits } = credentialCandidates(summary)
  if (usernames.length !== 1 || passwords.length !== 1) {
    return { action: 'stop', portal_id: portalId, reason: 'credential_fields_not_unique' }
  }
  if (submits.length > 1) return { action: 'stop', portal_id: portalId, reason: 'submit_control_not_unique' }
  const username = usernames[0]
  const password = passwords[0]
  const submit = submits[0]
  return {
    action: 'fill_credentials',
    portal_id: portalId,
    username_element: username.element,
    password_element: password.element,
    ...(submit ? { submit_control: submit.element } : {})
  }
}

export function validateModelDecision(decision, summary, portalId) {
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) throw new Error('モデル出力がJSONオブジェクトではありません')
  if (decision.portal_id !== portalId) throw new Error('モデル出力のportal_idが一致しません')
  if (decision.action === 'stop') {
    return { action: 'stop', portal_id: portalId, reason: boundedText(decision.reason, 160) || 'model_stop' }
  }
  if (decision.action !== 'fill_credentials') throw new Error('未許可のactionです')
  if (summary.blockers.length) throw new Error('MFAまたはCAPTCHAを検出したため入力できません')
  const usernameElement = Number(decision.username_element)
  const passwordElement = Number(decision.password_element)
  const submitControl = decision.submit_control == null ? null : Number(decision.submit_control)
  if (!Number.isInteger(usernameElement) || !Number.isInteger(passwordElement) || usernameElement === passwordElement) {
    throw new Error('資格情報欄の番号が不正です')
  }
  const username = summary.fields.find((field) => field.element === usernameElement)
  const password = summary.fields.find((field) => field.element === passwordElement)
  if (!username || !password) throw new Error('モデルが存在しない欄を指定しました')
  const candidates = credentialCandidates(summary)
  if (candidates.usernames.length !== 1 || candidates.passwords.length !== 1) {
    throw new Error('ID欄またはパスワード欄が一意ではありません')
  }
  if (candidates.usernames[0].element !== usernameElement) throw new Error('選択されたID欄をブローカーが確認できません')
  if (candidates.passwords[0].element !== passwordElement) throw new Error('選択されたパスワード欄をブローカーが確認できません')
  if (submitControl != null) {
    if (!Number.isInteger(submitControl)) throw new Error('送信コントロール番号が不正です')
    if (candidates.submits.length !== 1 || candidates.submits[0].element !== submitControl) {
      throw new Error('ログイン送信コントロールが一意ではありません')
    }
  }
  return {
    action: 'fill_credentials',
    portal_id: portalId,
    username_element: usernameElement,
    password_element: passwordElement,
    ...(submitControl == null ? {} : { submit_control: submitControl })
  }
}

function extractJsonObject(text) {
  const source = String(text || '').trim().replace(/^```(?:json)?\s{0,}/i, '').replace(/\s{0,}```$/, '')
  const start = source.indexOf('{')
  const end = source.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('モデル出力にJSONがありません')
  return JSON.parse(source.slice(start, end + 1))
}

export async function analyzeWithLocalModel(summary, portalId, { baseUrl = 'http://127.0.0.1:18080' } = {}) {
  const endpoint = new URL('/v1/chat/completions', baseUrl)
  if (!LOOPBACK_HOSTS.has(endpoint.hostname)) throw new Error('ローカルモデルはloopbackでのみ利用できます')
  const prompt = [
    '次のJSONは値を除去したログイン画面のDOM要約です。',
    '資格情報欄が一意ならfill_credentials、MFA・CAPTCHA・曖昧さがあればstopを返してください。',
    '返答はJSONだけにし、入力値や認証情報を要求しないでください。',
    `portal_idは必ず${JSON.stringify(portalId)}をそのまま返してください。`,
    '形式: {"action":"fill_credentials","portal_id":"...","username_element":1,"password_element":2,"submit_control":1}',
    '停止形式: {"action":"stop","portal_id":"...","reason":"..."}',
    JSON.stringify(summary)
  ].join('\n')
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'local-model', temperature: 0, max_tokens: 256, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(120000)
  })
  if (!response.ok) throw new Error(`ローカルモデル応答エラー: ${response.status}`)
  const payload = await response.json()
  return validateModelDecision(extractJsonObject(payload?.choices?.[0]?.message?.content), summary, portalId)
}
class CdpConnection {
  constructor(socket) {
    this.socket = socket
    this.sequence = 0
    this.pending = new Map()
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (!message.id) return
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message || 'CDP command failed'))
      else pending.resolve(message.result)
    })
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('Chromeとの接続が閉じました'))
      this.pending.clear()
    })
  }

  static async connect(url) {
    const socket = new WebSocket(url)
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', () => reject(new Error('Chromeへ接続できません')), { once: true })
    })
    return new CdpConnection(socket)
  }

  send(method, params = {}) {
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  close() {
    this.socket.close()
  }
}

async function fetchTargets(debugPort) {
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`, { signal: AbortSignal.timeout(5000) })
  if (!response.ok) throw new Error('Chromeのタブ一覧を取得できません')
  return (await response.json()).filter((target) => target.type === 'page' && target.webSocketDebuggerUrl)
}

export async function findTargetByOrigin(debugPort, allowedOrigin, allowedPathPrefix = null) {
  const matches = (await fetchTargets(debugPort)).filter(
    (target) => urlWithinAllowedScope(target.url, allowedOrigin, allowedPathPrefix)
  )
  if (matches.length !== 1) throw new Error(`登録済み適用範囲のタブが一意ではありません: ${matches.length}`)
  return matches[0]
}

async function evaluateTarget(target, expression) {
  const connection = await CdpConnection.connect(target.webSocketDebuggerUrl)
  try {
    const result = await connection.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error('ページ内処理が失敗しました')
    return result.result?.value
  } finally {
    connection.close()
  }
}

export async function readPageSummary(debugPort, allowedOrigin, allowedPathPrefix = null) {
  const target = await findTargetByOrigin(debugPort, allowedOrigin, allowedPathPrefix)
  const summary = sanitizePageSummary(await evaluateTarget(target, PAGE_SUMMARY_EXPRESSION))
  if (summary.origin !== allowedOrigin) throw new Error('ページoriginが登録値と一致しません')
  if (!urlWithinAllowedScope(target.url, allowedOrigin, allowedPathPrefix)) {
    throw new Error('ページURLが登録済みの適用範囲外です')
  }
  return { target, summary }
}

async function readCredentialRecord(credentialPath, portalId) {
  const record = JSON.parse((await readFile(credentialPath, 'utf8')).replace(/^\uFEFF/, ''))
  if (record.version !== 1 || record.portalId !== portalId) throw new Error('資格情報レコードが不正です')
  const allowedOrigin = normalizeAllowedOrigin(record.allowedOrigin, { allowLoopbackHttp: true })
  if (!record.usernameCiphertext || !record.passwordCiphertext) throw new Error('暗号化資格情報がありません')
  // 許可URLプレフィックスは秘密ではないので平文フィールド。未設定なら従来どおりorigin一致のみ(後方互換)。
  const allowedPathPrefix = record.allowedPathPrefix
    ? normalizeAllowedUrlPrefix(record.allowedPathPrefix, { allowLoopbackHttp: true })
    : null
  if (allowedPathPrefix && !allowedPathPrefix.startsWith(allowedOrigin)) {
    throw new Error('許可URLプレフィックスが許可originと一致しません')
  }
  return { allowedOrigin, allowedPathPrefix }
}

async function unprotectCredential(unprotectScript, credentialPath) {
  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', unprotectScript, '-CredentialPath', credentialPath
    ], { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 })
    const value = JSON.parse(stdout.trim())
    if (typeof value.username !== 'string' || typeof value.password !== 'string') throw new Error('invalid')
    return value
  } catch {
    throw new Error('DPAPI資格情報を復号できません')
  }
}

function fillExpression({ allowedOrigin, allowedPathPrefix, decision, username, password, submit }) {
  return String.raw`(() => {
    const expectedOrigin = ${JSON.stringify(allowedOrigin)}
    const expectedPrefix = ${JSON.stringify(allowedPathPrefix || null)}
    if (location.origin !== expectedOrigin) throw new Error('origin_mismatch')
    if (expectedPrefix && !(location.origin + location.pathname).startsWith(expectedPrefix)) throw new Error('path_mismatch')
    const visible = (element) => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }
    const bodyText = String(document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 6000)
    if (document.querySelector('iframe[src*="captcha" i], [class*="captcha" i], [id*="captcha" i], .g-recaptcha, [data-sitekey]') || /captcha|ロボットではない|私はロボットではありません/i.test(bodyText)) throw new Error('captcha')
    if (document.querySelector('input[autocomplete="one-time-code"]') || /ワンタイム|認証コード|確認コード|verification code|two[- ]factor|multi[- ]factor|\bmfa\b/i.test(bodyText)) throw new Error('mfa')
    const fields = Array.from(document.querySelectorAll('input, textarea, select'))
      .filter((element) => visible(element) && !['hidden', 'submit', 'button', 'reset', 'image'].includes((element.type || '').toLowerCase()))
    const controls = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"]')).filter(visible)
    const usernameField = fields[${decision.username_element - 1}]
    const passwordField = fields[${decision.password_element - 1}]
    const fieldText = (element) => [element.labels ? Array.from(element.labels).map((label) => label.innerText).join(' ') : '', element.getAttribute('aria-label'), element.name, element.id, element.placeholder, element.autocomplete].join(' ')
    const typedUsernameCandidates = fields.filter((element) => !element.disabled && ['text', 'email', 'tel'].includes((element.type || '').toLowerCase()))
    const recognizedUsernameCandidates = typedUsernameCandidates.filter((element) => ['username', 'email'].includes((element.autocomplete || '').toLowerCase()) || /メール|mail|email|ログイン|login|user|ユーザー|会員id|account/i.test(fieldText(element)))
    const passwordCandidates = fields.filter((element) => !element.disabled && (element.type || '').toLowerCase() === 'password')
    const usernameCandidates = recognizedUsernameCandidates.length === 0 && typedUsernameCandidates.length === 1 && passwordCandidates.length === 1 ? typedUsernameCandidates : recognizedUsernameCandidates
    const submitCandidates = controls.filter((element) => !element.disabled && ((element.type || '').toLowerCase() === 'submit' || /ログイン|login|sign in|次へ|continue/i.test(element.innerText || element.value || element.getAttribute('aria-label') || '')))
    if (!usernameField || !passwordField || usernameCandidates.length !== 1 || passwordCandidates.length !== 1 || usernameCandidates[0] !== usernameField || passwordCandidates[0] !== passwordField) throw new Error('field_mismatch')
    const control = ${Boolean(submit)} ? controls[${decision.submit_control == null ? -1 : decision.submit_control - 1}] : null
    if (${Boolean(submit)} && (submitCandidates.length !== 1 || submitCandidates[0] !== control)) throw new Error('submit_control_mismatch')
    const setValue = (element, value) => {
      const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
      if (!setter) throw new Error('value_setter_missing')
      setter.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
    }
    setValue(usernameField, ${JSON.stringify(username)})
    setValue(passwordField, ${JSON.stringify(password)})
    if (${Boolean(submit)}) control.click()
    return { filled: true, submitted: ${Boolean(submit)}, origin: location.origin }
  })()`
}

export async function brokerFill({ portalId, credentialPath, decision, debugPort, unprotectScript, submit = false }) {
  validatePortalId(portalId)
  const { allowedOrigin, allowedPathPrefix } = await readCredentialRecord(credentialPath, portalId)
  const { target, summary } = await readPageSummary(debugPort, allowedOrigin, allowedPathPrefix)
  if (summary.blockers.length) return { status: 'stopped', portalId, origin: allowedOrigin, reason: summary.blockers.join(',') }
  const checked = validateModelDecision(decision, summary, portalId)
  if (checked.action === 'stop') return { status: 'stopped', portalId, origin: allowedOrigin, reason: checked.reason }
  if (submit && checked.submit_control == null) throw new Error('送信コントロールが指定されていません')
  let credential = await unprotectCredential(unprotectScript, credentialPath)
  try {
    const currentTarget = await findTargetByOrigin(debugPort, allowedOrigin, allowedPathPrefix)
    if (currentTarget.id !== target.id) throw new Error('入力前に対象タブが変わりました')
    const result = await evaluateTarget(currentTarget, fillExpression({
      allowedOrigin,
      allowedPathPrefix,
      decision: checked,
      username: credential.username,
      password: credential.password,
      submit
    }))
    if (!result?.filled) throw new Error('資格情報を入力できませんでした')
    return { status: submit ? 'submitted' : 'filled', portalId, origin: allowedOrigin }
  } finally {
    credential.username = ''
    credential.password = ''
    credential = null
  }
}

export async function navigateTarget(debugPort, allowedOrigin, url) {
  const target = await findTargetByOrigin(debugPort, allowedOrigin)
  const connection = await CdpConnection.connect(target.webSocketDebuggerUrl)
  try {
    await connection.send('Page.navigate', { url })
  } finally {
    connection.close()
  }
}

export async function readSafePageState(debugPort, allowedOrigin) {
  const target = await findTargetByOrigin(debugPort, allowedOrigin)
  return evaluateTarget(target, String.raw`(() => ({
    origin: location.origin,
    result: document.querySelector('[data-result]')?.getAttribute('data-result') || '',
    passwordValuePresent: Boolean(document.querySelector('input[type="password"]')?.value)
  }))()`)
}

/**
 * ログイン後ページの可視テキストと同一originリンクだけを読む。
 * input値、Cookie、認証ヘッダー、storageは取得しない。
 */
export async function readSafeVisiblePage(debugPort, allowedOrigin, allowedPathPrefix = null) {
  const target = await findTargetByOrigin(debugPort, allowedOrigin, allowedPathPrefix)
  const result = await evaluateTarget(target, String.raw`(() => {
    const visible = (element) => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }
    const text = (value, limit) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit)
    const links = Array.from(document.querySelectorAll('a[href]'))
      .filter(visible)
      .map((element) => {
        try {
          const url = new URL(element.href, location.href)
          if (url.origin !== location.origin) return null
          return { text: text(element.innerText || element.getAttribute('aria-label'), 240), url: url.href }
        } catch { return null }
      })
      .filter((item) => item && item.text)
      .slice(0, 120)
    const actions = Array.from(document.querySelectorAll('button, [role="button"], [onclick]'))
      .filter(visible)
      .map((element, index) => ({
        element: index + 1,
        tag: element.tagName.toLowerCase(),
        id: text(element.id, 120),
        label: text(element.innerText || element.value || element.getAttribute('aria-label'), 500)
      }))
      .filter((item) => item.label)
      .slice(0, 120)
    return {
      origin: location.origin,
      url: location.href,
      title: text(document.title, 240),
      text: text(document.body?.innerText, 30000),
      links,
      actions
    }
  })()`)
  if (result?.origin !== allowedOrigin || !urlWithinAllowedScope(result?.url, allowedOrigin, allowedPathPrefix)) {
    throw new Error('可視ページが登録済みの適用範囲外です')
  }
  return result
}

export async function clickSafeVisibleAction(debugPort, allowedOrigin, allowedPathPrefix, actionElement) {
  if (!Number.isInteger(actionElement) || actionElement <= 0) throw new Error('action elementが不正です')
  const target = await findTargetByOrigin(debugPort, allowedOrigin, allowedPathPrefix)
  if (!urlWithinAllowedScope(target.url, allowedOrigin, allowedPathPrefix)) throw new Error('対象ページが登録済みの適用範囲外です')
  return evaluateTarget(target, String.raw`(() => {
    const visible = (element) => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }
    const actions = Array.from(document.querySelectorAll('button, [role="button"], [onclick]'))
      .filter(visible)
      .filter((element) => String(element.innerText || element.value || element.getAttribute('aria-label') || '').trim())
    const action = actions[${actionElement - 1}]
    if (!action) throw new Error('action_not_found')
    const label = String(action.innerText || action.value || action.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 500)
    action.click()
    return { clicked: true, label }
  })()`)
}
