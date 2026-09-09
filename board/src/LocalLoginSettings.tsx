import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button, Checkbox, Input } from 'smarthr-ui'
import LocalLoginGuide from './LocalLoginGuide'
import LocalLoginPortalForm from './LocalLoginPortalForm'

// 端末設定サーバーの / は同じ設定画面へ戻るため、アプリ本体のホームへ移動する。
const HOME_URL = window.location.hostname === '127.0.0.1' ? 'https://katazuku-app.kotalabo.com/' : '/'

type Preferences = { version: 1; enabled: boolean; time: string; portalIds: string[] }
export type Portal = {
  id: string; label: string; loginUrl: string; authMode: 'sso' | 'password'; credentialStored: boolean
  presetId: string
  lastResult: { at: string; status: string; message: string } | null
}
export type SettingsState = {
  machine: string; timeZone: string; preferences: Preferences; revision: string; portals: Portal[]
  presets: { id: string; label: string }[]
  schedule: { registered: boolean; enabled: boolean; time: string | null; state: string }
}

async function request<T>(path: string, token: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api/local-login/${path}`, {
      method: body === undefined ? 'GET' : 'POST', cache: 'no-store', signal: signal ?? AbortSignal.timeout(45000),
      headers: { 'X-Katazuku-Token': token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch {
    throw new Error(body === undefined
      ? 'PCの設定画面に接続できません。起動し直してから再読み込みしてください。'
      : '処理結果を受け取れませんでした。再読み込みして保存状態を確認してください。')
  }
  const result = await response.json().catch(() => { throw new Error('PCの設定画面に接続できません。起動方法を確認してください。') })
  if (!response.ok) throw new Error(result.error || '処理を完了できませんでした。')
  return result as T
}

function CredentialForm({ portal, token, revision, onClose, onSaved }: {
  portal: Portal; token: string; revision: string; onClose: () => void; onSaved: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const node = dialog.current
    node?.showModal()
    return () => { form.current?.reset(); node?.close() }
  }, [])
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(''); setBusy(true)
    const values = new FormData(event.currentTarget)
    const payload = { username: String(values.get('username') || ''), password: String(values.get('password') || ''), revision }
    values.delete('username'); values.delete('password')
    // React state・localStorageへ秘密値を保存せず、送信開始時に入力欄を消す。
    form.current?.reset()
    try { await request(`portals/${portal.id}/credentials`, token, payload); onSaved() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '保存できませんでした。') }
    finally { payload.username = ''; payload.password = ''; setBusy(false) }
  }
  return (
    <dialog ref={dialog} className="app-dialog" aria-labelledby="credential-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose() }}>
      <form ref={form} onSubmit={save} className="flex flex-col gap-4 p-6" autoComplete="off">
        <h2 id="credential-title" className="text-lg font-bold">{portal.label}のログイン情報</h2>
        <p className="break-all text-sm text-slate-600">保存先：このPC<br />ログイン先：{portal.loginUrl}</p>
        <p className="text-sm leading-6 text-slate-600">Windowsで暗号化して保存します。登録済みの場合は新しい情報に置き換えます。</p>
        <fieldset disabled={busy} className="flex min-w-0 flex-col gap-4">
          <label className="flex flex-col gap-2 text-sm font-bold">ログインID・メールアドレス
            <Input name="username" type="text" required maxLength={1024} autoComplete="off" autoFocus />
          </label>
          <label className="flex flex-col gap-2 text-sm font-bold">パスワード
            <Input name="password" type="password" required maxLength={4096} autoComplete="new-password" />
          </label>
        </fieldset>
        {error && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-3">
          <Button type="button" onClick={onClose} disabled={busy}>キャンセル</Button>
          <Button type="submit" variant="primary" disabled={busy}>{busy ? '保存中…' : '暗号化して保存'}</Button>
        </div>
      </form>
    </dialog>
  )
}

function SettingsEditor() {
  const token = useRef('')
  const [state, setState] = useState<SettingsState | null>(null)
  const [draft, setDraft] = useState<Preferences | null>(null)
  const [busy, setBusy] = useState<string | null>('load')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [credentialPortal, setCredentialPortal] = useState<Portal | null>(null)
  const [portalEditor, setPortalEditor] = useState<{ portal?: Portal } | null>(null)

  async function load(signal?: AbortSignal) {
    setBusy('load'); setError('')
    try {
      const session = await request<{ service: string; token: string }>('session', '', undefined, signal)
      if (session.service !== 'katazuku-local-login' || !session.token) throw new Error('自動ログインの設定画面ではありません。起動方法を確認してください。')
      token.current = session.token
      const next = await request<SettingsState>('state', token.current, undefined, signal)
      if (!signal?.aborted) { setState(next); setDraft(next.preferences) }
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : '設定を読み込めませんでした。')
    } finally { if (!signal?.aborted) setBusy(null) }
  }
  useEffect(() => {
    document.title = '自動ログイン設定 | katazuku'
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [])

  const dirty = Boolean(state && draft && JSON.stringify(draft) !== JSON.stringify(state.preferences))
  useEffect(() => {
    if (!dirty) return
    const warnUnsaved = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warnUnsaved)
    return () => window.removeEventListener('beforeunload', warnUnsaved)
  }, [dirty])
  const mismatch = state && (state.preferences.enabled !== state.schedule.enabled ||
    (state.preferences.enabled && state.preferences.time !== state.schedule.time))
  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft || !state) return
    setBusy('save'); setError(''); setMessage('')
    try {
      const next = await request<SettingsState>('settings', token.current, { preferences: draft, revision: state.revision })
      setState(next); setDraft(next.preferences)
      setMessage(next.preferences.enabled ? `保存しました。毎日${next.preferences.time}に、このPCで実行します。` : '保存しました。毎日の自動ログインを停止しました。')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存できませんでした。') }
    finally { setBusy(null) }
  }
  async function openLogin(portal: Portal) {
    setBusy(portal.id); setError(''); setMessage('')
    try {
      await request(`portals/${portal.id}/login`, token.current, { revision: state?.revision })
      setMessage(`${portal.label}の専用Chromeを開きました。ログインが終わったら、そのウィンドウを閉じてください。`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'ログイン画面を開けませんでした。') }
    finally { setBusy(null) }
  }

  return (
    <main className="mx-auto max-w-4xl px-5 py-8 sm:px-8">
      <header className="mb-7 flex items-center gap-3 border-b border-slate-300 pb-5">
        <a href={HOME_URL} aria-label="katazuku ホーム" className="flex min-h-11 items-center gap-3">
          <img src="/icons/necktie-192.png" alt="" width={36} height={36} />
          <span className="font-bold">katazuku</span>
        </a>
        <a href={HOME_URL} className="ml-auto inline-flex min-h-11 items-center text-sm text-blue-700 underline">ホームに戻る</a>
      </header>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">自動ログイン</h1>
          <p className="mt-2 text-sm leading-7 text-slate-600">毎日ログインするサービスと、実行する時刻を設定します。</p>
          {state && <p className="mt-1 text-xs text-slate-600">実行するPC：{state.machine} / 時刻：{state.timeZone}</p>}
        </div>
        <Button type="button" size="S" onClick={() => { setMessage(''); void load() }} disabled={Boolean(busy)}>{dirty ? '変更を破棄して再読み込み' : '再読み込み'}</Button>
      </div>
      {error && <p role="alert" className="mb-5 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}
      {message && <p role="status" className="mb-5 rounded border border-blue-200 bg-blue-50 p-4 text-sm">{message}</p>}
      {busy === 'load' && <p role="status" className="py-8 text-sm text-slate-600">このPCの設定を読み込んでいます…</p>}
      {!state && !busy && <LocalLoginGuide />}
      {state && draft && (
        <>
          <form onSubmit={save}>
            <fieldset disabled={Boolean(busy)} className="min-w-0">
              <section className="mb-7 rounded border border-slate-300 p-5" aria-labelledby="schedule-title">
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  <h2 id="schedule-title" className="font-bold">実行スケジュール</h2>
                  <span className={`rounded px-2 py-1 text-xs font-bold ${state.schedule.enabled && state.preferences.enabled ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>
                    {state.schedule.enabled && state.preferences.enabled ? '有効' : state.schedule.registered ? '停止中' : '未設定'}
                  </span>
                </div>
                {mismatch && <p className="mb-4 text-sm text-red-700">Windowsの実行予約と保存済み設定が異なります。内容を確認して保存すると、表示中の設定に揃えます。</p>}
                <Checkbox checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}>毎日の自動ログインを有効にする</Checkbox>
                <div className="mt-5 flex flex-wrap items-center gap-x-8 gap-y-4">
                  <label className="flex items-center gap-3 text-sm font-bold">毎日の実行時刻
                    <Input type="time" required value={draft.time} onChange={(event) => setDraft({ ...draft, time: event.target.value })} />
                  </label>
                  <p className="max-w-sm text-xs leading-6 text-slate-600">このPCにログオンしている間に実行します。電源が切れていた場合は、次に実行できるときに処理します。</p>
                </div>
              </section>
              <section aria-labelledby="portals-title">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 id="portals-title" className="font-bold">ログインするサービス</h2>
                  <Button type="button" size="S" onClick={() => setPortalEditor({})}>サービスを追加</Button>
                </div>
                <p className="mt-2 text-sm leading-7 text-slate-600">対象を選び、初回のログインを済ませます。Googleログインや追加認証は、専用Chromeで本人が操作してください。</p>
                <div className="mt-4 border-t border-slate-300">
                  {state.portals.length === 0 && <div className="border-b border-slate-300 py-8 text-center">
                    <p className="font-bold">サービスはまだ登録されていません</p>
                    <p className="mt-2 text-sm leading-7 text-slate-600">「サービスを追加」から正式名称を選び、ログインURLを設定してください。</p>
                  </div>}
                  {state.portals.map((portal) => (
                    <article key={portal.id} className="flex flex-col gap-4 border-b border-slate-300 py-5 sm:flex-row sm:items-start">
                      <div className="min-w-0 flex-1">
                        <Checkbox checked={draft.portalIds.includes(portal.id)} onChange={(event) => setDraft({
                          ...draft, portalIds: (event.target.checked ? [...draft.portalIds, portal.id] : draft.portalIds.filter((id) => id !== portal.id)).sort(),
                        })}>{portal.label}</Checkbox>
                        <p className="ml-7 mt-2 text-xs text-slate-600">
                          {portal.authMode === 'sso' ? 'Google等でログイン・パスワード登録不要' : portal.credentialStored ? 'ログイン情報：登録済み' : 'ログイン情報：未登録'}
                        </p>
                        <a className="ml-7 mt-2 block break-all text-xs text-blue-700 underline" href={portal.loginUrl} target="_blank" rel="noreferrer">ログイン先を確認</a>
                        <p className="ml-7 mt-3 text-xs leading-6 text-slate-600">
                          {portal.lastResult ? <>{new Date(portal.lastResult.at).toLocaleString('ja-JP')}<br />{portal.lastResult.message}</> : '最近の実行記録はありません'}
                        </p>
                      </div>
                      <div className="ml-7 flex shrink-0 flex-wrap gap-2 sm:ml-0 sm:flex-col sm:items-stretch">
                        <Button type="button" size="S" onClick={() => setPortalEditor({ portal })}>接続先を変更</Button>
                        {portal.authMode === 'password' && <Button type="button" size="S" onClick={() => setCredentialPortal(portal)}>{portal.credentialStored ? 'ログイン情報を変更' : 'ログイン情報を登録'}</Button>}
                        <Button type="button" size="S" onClick={() => void openLogin(portal)}>{busy === portal.id ? '起動中…' : '専用Chromeでログイン'}</Button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
              <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded border border-slate-300 bg-white p-4">
                <div className="text-sm">
                  <p className="font-bold">{draft.portalIds.length}件を選択 / {draft.enabled ? `毎日 ${draft.time}` : '自動ログインは停止'}</p>
                  <p className="mt-1 text-xs text-slate-600">{dirty ? '変更はまだ保存されていません。' : '保存すると、このPCの実行予約に反映します。'}</p>
                </div>
                <div className="flex gap-2">
                  {dirty && <Button type="button" onClick={() => { setDraft(state.preferences); setError('') }}>変更を戻す</Button>}
                  <Button type="submit" variant="primary" disabled={draft.enabled && draft.portalIds.length === 0}>{busy === 'save' ? '保存中…' : '設定を保存'}</Button>
                </div>
              </div>
            </fieldset>
          </form>
          <p className="mt-6 text-xs leading-6 text-slate-600">設定とログイン情報はこのPCに保存します。追加認証やセッション切れで止まった場合は「専用Chromeでログイン」から再ログインし、ウィンドウを閉じてください。</p>
          {portalEditor && <LocalLoginPortalForm state={state} portal={portalEditor.portal} onClose={() => setPortalEditor(null)} onSave={async (value) => {
            const result = await request<{ state: SettingsState; reauthenticationRequired: boolean }>('portals', token.current, value)
            setState(result.state)
            setPortalEditor(null); setError('')
            setMessage(result.reauthenticationRequired ? '接続先を保存しました。ログイン情報を登録するか、専用Chromeで初回ログインを済ませてください。' : '接続先を保存しました。')
          }} />}
          {credentialPortal && <CredentialForm portal={credentialPortal} token={token.current} revision={state.revision} onClose={() => setCredentialPortal(null)} onSaved={() => {
            setState((previous) => previous && ({ ...previous, portals: previous.portals.map((portal) => portal.id === credentialPortal.id ? { ...portal, credentialStored: true } : portal) }))
            setCredentialPortal(null); setMessage('ログイン情報をこのPCに暗号化して保存しました。'); setError('')
          }} />}
        </>
      )}
    </main>
  )
}

export default function LocalLoginSettings() {
  if (window.location.hostname !== '127.0.0.1') {
    return <main className="mx-auto max-w-3xl p-6"><a href={HOME_URL} className="inline-flex min-h-11 items-center text-sm text-blue-700 underline">ホームに戻る</a><LocalLoginGuide /></main>
  }
  return <SettingsEditor />
}
