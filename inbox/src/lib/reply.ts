import type { Email } from '../types'

export interface ReplyDraft {
  to: string
  subject: string
  body: string
}

export function emptyReplyDraft(email: Email): ReplyDraft {
  return {
    to: email.fromAddress,
    subject: email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`,
    body: '',
  }
}

export async function generateReply(email: Email): Promise<string> {
  const response = await fetch('/api/generate-reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(email),
  })
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    throw new Error('Claude返信生成は、Claude Codeにログイン済みのPCでローカル起動した場合に利用できます')
  }
  const data = await response.json() as { body?: string; error?: string }
  if (!response.ok || !data.body) {
    throw new Error(data.error || '返信文を生成できませんでした')
  }
  return data.body
}

/** 宛先・件名・本文を埋めた状態でGmailの作成画面を開くURL */
export function gmailComposeUrl(draft: ReplyDraft): string {
  const params = new URLSearchParams({
    view: 'cm',
    fs: '1',
    to: draft.to,
    su: draft.subject,
    body: draft.body,
  })
  return `https://mail.google.com/mail/?${params}`
}
