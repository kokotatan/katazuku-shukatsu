import { useCallback, useEffect, useState } from 'react'
import { AnchorButton, Button, Dialog, Textarea } from 'smarthr-ui'
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
    <Dialog isOpen width="32rem" onClickOverlay={onClose} onPressEscape={onClose}>
      <div className="flex max-h-[85vh] flex-col p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">返信を作成</h2>
          <Button size="S" variant="text" onClick={onClose}>
            閉じる
          </Button>
        </div>

        <p className="mb-1 text-xs text-slate-500">宛先: {draft.to}</p>
        <p className="mb-3 truncate text-xs text-slate-500">件名: {draft.subject}</p>

        <Textarea
          width="100%"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={14}
          disabled={generating}
          placeholder={generating ? 'Claudeで返信文を生成しています…' : '返信本文'}
          className="mb-2"
        />
        {error && <p className="mb-3 text-xs text-red-600">{error}</p>}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <AnchorButton
            variant="primary"
            href={gmailComposeUrl(draft)}
            target="_blank"
            rel="noreferrer"
            aria-disabled={generating || !body}
            onClick={(event) => {
              if (generating || !body) event.preventDefault()
            }}
          >
            Gmailで開いて送信
          </AnchorButton>
          <Button variant="secondary" onClick={() => void regenerate()} disabled={generating}>
            {generating ? '生成中…' : '再生成'}
          </Button>
          <Button
            variant="secondary"
            onClick={async () => {
              await navigator.clipboard.writeText(body)
              onCopied()
            }}
            disabled={generating || !body}
          >
            本文をコピー
          </Button>
          <Button className="ml-auto" variant="secondary" onClick={onClose}>
            閉じる
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
