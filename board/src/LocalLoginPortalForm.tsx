import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button, Input } from 'smarthr-ui'
import type { Portal, SettingsState } from './LocalLoginSettings'

export default function LocalLoginPortalForm({ state, portal, onClose, onSave }: {
  state: SettingsState; portal?: Portal; onClose: () => void
  onSave: (value: { id?: string; presetId: string; label: string; loginUrl: string; authMode: 'sso' | 'password'; revision: string }) => Promise<void>
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [presetId, setPresetId] = useState(portal?.presetId || '')
  const [label, setLabel] = useState(portal?.label || '')
  const [loginUrl, setLoginUrl] = useState(portal?.loginUrl || '')
  const [authMode, setAuthMode] = useState<'sso' | 'password'>(portal?.authMode || 'sso')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const node = dialog.current
    node?.showModal()
    return () => node?.close()
  }, [])
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try { await onSave({ id: portal?.id, presetId, label, loginUrl, authMode, revision: state.revision }) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '接続先を保存できませんでした。') }
    finally { setBusy(false) }
  }
  const selected = state.presets.find((preset) => preset.id === presetId)
  const changed = portal && (portal.loginUrl !== loginUrl.trim() || portal.authMode !== authMode)
  return (
    <dialog ref={dialog} className="app-dialog" aria-labelledby="portal-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose() }}>
      <form onSubmit={submit} className="flex flex-col gap-5 p-6">
        <div>
          <h2 id="portal-title" className="text-lg font-bold">{portal ? '接続先を変更' : 'ログインするサービスを追加'}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">サービスを選び、普段使っているログインページのURLを入力します。</p>
        </div>
        <fieldset disabled={busy} className="flex min-w-0 flex-col gap-4">
          <label className="flex flex-col gap-2 text-sm font-bold">サービス名
            <select className="min-h-11 w-full rounded border border-slate-400 bg-white px-3 text-base" value={presetId} onChange={(event) => setPresetId(event.target.value)} autoFocus>
              <option value="">自分でサービス名を入力</option>
              {state.presets.map((preset) => <option key={preset.id} value={preset.id} disabled={state.portals.some((item) => item.id !== portal?.id && item.presetId === preset.id)}>{preset.label}</option>)}
            </select>
          </label>
          {!selected && <label className="flex flex-col gap-2 text-sm font-bold">サービス名を入力
            <Input required maxLength={100} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="企業の採用マイページなど" />
          </label>}
          <label className="flex flex-col gap-2 text-sm font-bold">ログインURL
            <Input type="url" required maxLength={2048} value={loginUrl} onChange={(event) => setLoginUrl(event.target.value)} placeholder="https://…" aria-describedby="login-url-hint" />
          </label>
          <p id="login-url-hint" className="-mt-2 text-xs leading-6 text-slate-600">本人が使うHTTPSのログインページを指定してください。認証コードなどが付いた一時URLは使えません。</p>
          <label className="flex flex-col gap-2 text-sm font-bold">認証方法
            <select className="min-h-11 w-full rounded border border-slate-400 bg-white px-3 text-base" value={authMode} onChange={(event) => setAuthMode(event.target.value as 'sso' | 'password')}>
              <option value="sso">ブラウザのログイン状態を維持（Google等）</option>
              <option value="password">ID・パスワードでログイン</option>
            </select>
          </label>
        </fieldset>
        {changed && <p role="status" className="rounded bg-blue-50 p-3 text-sm leading-6">接続先や認証方法を変えると、ログイン情報の再登録または専用Chromeでの再ログインが必要です。</p>}
        {!portal && <p className="text-xs leading-6 text-slate-600">追加しただけでは毎日ログインしません。追加後に初回ログインを済ませ、実行対象に選んでください。</p>}
        {error && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-3">
          <Button type="button" disabled={busy} onClick={onClose}>キャンセル</Button>
          <Button type="submit" variant="primary" disabled={busy}>{busy ? '保存中…' : portal ? '接続先を保存' : 'サービスを追加'}</Button>
        </div>
      </form>
    </dialog>
  )
}
