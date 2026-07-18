import { useState, type FormEvent } from 'react'

export function DataState({
  loading,
  error,
  onSaveKey,
}: {
  loading: boolean
  error: string
  onSaveKey: (key: string) => void
}) {
  const [key, setKey] = useState('')
  if (loading) {
    return <div className="rounded-xl border border-slate-300 bg-white p-8 text-sm text-slate-600">DBから最新データを読み込んでいます。</div>
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (key.trim()) onSaveKey(key)
  }
  return (
    <section className="max-w-lg rounded-xl border border-slate-300 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-bold text-slate-900">DBへ接続</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">{error || '閲覧用の合言葉が必要です。'}</p>
      <form onSubmit={submit} className="mt-5 flex gap-2">
        <label className="sr-only" htmlFor="katazuku-read-key">閲覧用の合言葉</label>
        <input
          id="katazuku-read-key"
          value={key}
          onChange={(event) => setKey(event.target.value)}
          type="password"
          autoComplete="current-password"
          className="min-w-0 flex-1 rounded-md border border-slate-400 bg-white px-3 py-2 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
          placeholder="合言葉"
        />
        <button type="submit" className="rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700">
          接続
        </button>
      </form>
    </section>
  )
}
