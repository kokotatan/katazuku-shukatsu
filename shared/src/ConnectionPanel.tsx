import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react'
import { viewer } from './connection'

declare global {
  interface Window {
    katazukuDesktop?: { connect: () => Promise<{ origin: string; pairingCode: string }>; settings: () => Promise<void> }
  }
}
export function ConnectionStatus() {
  const state = useSyncExternalStore(viewer.subscribe, viewer.getState)
  const [error, setError] = useState('')
  const disconnect = async () => {
    setError('')
    try {
      await viewer.disconnect()
      const response = await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: '{}', cache: 'no-store' })
      if (!response.ok && response.status !== 404) throw new Error('logout_failed')
    }
    catch { setError('画面の連携は解除しました。保存先へ接続できないため、閲覧権限は有効期限まで残る場合があります。') }
  }
  return <div className="connection-status">
    <span>{state.connection ? `連携中: ${state.connection.deviceName}` : 'PCと未連携'}</span>
    {state.connection && <button className="ktz-reload" type="button" onClick={() => void disconnect()}>連携を解除</button>}
    {window.katazukuDesktop && <button className="ktz-reload" type="button" onClick={() => void window.katazukuDesktop?.settings()}>PCの設定</button>}
    {error && <p role="alert">{error}</p>}
  </div>
}
export function ConnectionPanel({ loading, error, onReload }: { loading: boolean; error: string; onReload: () => void }) {
  const state = useSyncExternalStore(viewer.subscribe, viewer.getState)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [origin, setOrigin] = useState('')
  const [key, setKey] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    if (!viewer.getState().connection) void fetch('/api/auth/status', { signal: controller.signal, cache: 'no-store', credentials: 'same-origin' })
      .then(response => response.ok ? response.json() : null)
      .then(async result => { if (result?.authenticated && !controller.signal.aborted && !viewer.getState().connection) await viewer.connect(window.location.origin, { browserSession: true }) })
      .catch(() => {})
    return () => controller.abort()
  }, [])
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setMessage('')
    try { await operation() } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) setMessage(reason instanceof Error ? reason.message : '連携できませんでした。もう一度お試しください。')
    } finally { setBusy(false) }
  }
  const local = () => run(async () => {
    const bridge = window.katazukuDesktop
    if (!bridge) return
    const connection = await bridge.connect()
    await viewer.connect(connection.origin, { pairingCode: connection.pairingCode })
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const password = key
    setKey('')
    void run(() => viewer.connect(origin || window.location.origin, { password }))
  }
  return <div className="access-form" aria-busy={loading || busy}>
    <h2>{state.connection ? 'PCの記録を確認しています' : '自分のPCの記録を見る'}</h2>
    <p>選考やメールの記録は、連携したPCのデータを表示します。</p>
    {state.connection ? <>
      <p>連携先: <strong>{state.connection.deviceName}</strong></p>
      <button type="button" onClick={onReload} disabled={loading}>{loading ? '読み込み中…' : 'もう一度読み込む'}</button>
    </> : window.katazukuDesktop ? <>
      <p>このPCで設定した保存先を開きます。</p>
      <button type="button" onClick={() => void local()} disabled={busy}>{busy ? '連携しています…' : 'このPCと連携する'}</button>
    </> : <>
      <p>PCで「katazukuの設定」を開き、保存先とパスワード、Googleとの連携を設定します。</p>
      <a className="connection-guide" href="https://github.com/kokotatan/katazuku-shukatsu/blob/main/docs/GETTING-STARTED.md" target="_blank" rel="noopener noreferrer">はじめ方を確認する</a>
      <div className="connection-advanced">
        <p>初回設定が済んでいる方は、設定したパスワードでログインできます。</p>
        <form onSubmit={submit}>
          <label htmlFor="viewer-origin">接続先のアドレス</label>
          <input id="viewer-origin" type="url" autoComplete="url" placeholder={window.location.origin} value={origin} disabled={busy} onChange={event => { setOrigin(event.target.value); setKey(''); setMessage('') }} />
          <label htmlFor="viewer-key">katazukuのパスワード</label>
          <input id="viewer-key" type="password" autoComplete="current-password" required value={key} disabled={busy} onChange={event => setKey(event.target.value)} />
          <button type="submit" disabled={busy || !key}>{busy ? 'ログインしています…' : 'ログイン'}</button>
        </form>
      </div>
    </>}
    {(message || error || state.notice) && <p className="access-error" role="alert">{message || error || state.notice}</p>}
    {(busy || loading) && <p role="status">接続を確認しています。</p>}
  </div>
}
