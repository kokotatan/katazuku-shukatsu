import { useCallback, useEffect, useState } from 'react'
import type { Email } from '../types'
import { emptyReplyDraft, generateReply, gmailComposeUrl } from '../lib/reply'

interface Props {
  email: Email
  onClose: () => void
  onCopied: () => void
}

export function ReplyModal({ email, onClose, onCopied }: Props) {
  const template = emptyReplyDraft(email)
  const [body, setBody] = useState('')
  const [generating, setGenerating] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const draft = { ...template, body }
  const regenerate = useCallback(async () => {
    setGenerating(true)
    setError(null)
    try {
      setBody(await generateReply(email))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setGenerating(false)
    }
  }, [email])

  useEffect(() => {
    void regenerate()
  }, [regenerate])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">返信を作成</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>

        <p className="mb-1 text-xs text-slate-500">宛先: {draft.to}</p>
        <p className="mb-3 truncate text-xs text-slate-500">件名: {draft.subject}</p>

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={14}
          disabled={generating}
          placeholder={generating ? 'Claudeで返信文を生成しています…' : '返信本文'}
          className="mb-2 w-full flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 font-sans text-sm leading-relaxed focus:border-slate-500 focus:outline-none"
        />
        {error && <p className="mb-3 text-xs text-red-600">{error}</p>}

        <div className="flex items-center gap-2">
          <a
            href={gmailComposeUrl(draft)}
            target="_blank"
            rel="noreferrer"
            aria-disabled={generating || !body}
            onClick={(event) => {
              if (generating || !body) event.preventDefault()
            }}
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition ${
              generating || !body ? 'cursor-not-allowed bg-slate-300' : 'bg-slate-900 hover:bg-slate-700'
            }`}
          >
            Gmailで開いて送信 ↗
          </a>
          <button
            onClick={() => void regenerate()}
            disabled={generating}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generating ? '生成中…' : '再生成'}
          </button>
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(body)
              onCopied()
            }}
            disabled={generating || !body}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            本文をコピー
          </button>
          <button onClick={onClose} className="ml-auto rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}
