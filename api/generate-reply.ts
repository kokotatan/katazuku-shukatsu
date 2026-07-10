/**
 * 返信文生成API (Vercel Functions版)。docs/specs/01-reply-api.md が仕様。
 *
 * POST /api/generate-reply に Inbox の Email オブジェクト(inbox/src/types.ts)がJSONで届き、
 * Claude API(claude-haiku-4-5)で日本語のビジネス返信文を生成して { body } を返す。
 * ANTHROPIC_API_KEY 未設定・API障害時はルールベースのテンプレート(buildReplyTemplate)に
 * フォールバックし、モーダルが「生成できませんでした」で止まらないようにする。
 *
 * 注意: メール本文は個人情報のため、いかなる場合もログに出力しないこと。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

const MAX_REQUEST_BYTES = 200_000
const CLAUDE_MODEL = 'claude-haiku-4-5'
const CLAUDE_TIMEOUT_MS = 60_000

/** 署名(ローカル版 inbox/vite.claude-reply.ts と同一内容を保つ) */
const SIGNATURE = `奥山彪太郎
東北大学大学院工学研究科ロボティクス専攻
平田・董研究室
修士1年
okuyama.kotaro.career@gmail.com
090-6746-0159`

/** 差出人情報から宛名を作る。会社名があれば「社名 + 採用ご担当者様」、なければ「採用ご担当者様」 */
export function buildSalutation(email: Record<string, unknown>): string {
  const company = String(email.company ?? '').trim()
  if (company === '') return '採用ご担当者様'
  // 差出人名が個人名として書かれていても確実性がないため、会社宛の定型に寄せる
  return `${company}\n採用ご担当者様`
}

/**
 * ルールベースの返信テンプレート(フォールバック用の純粋関数)。
 * カテゴリ別の意図:
 * - interview: 日程候補を3つ提示(日時はプレースホルダのまま)
 * - test:      期日までに受検する旨
 * - task:      対応する旨
 * - result:    確認した旨
 * - それ以外:  確認した旨の汎用返信
 */
export function buildReplyTemplate(email: Record<string, unknown>): string {
  const category = String(email.category ?? '')

  let main: string
  switch (category) {
    case 'interview':
      main = `面接日程のご連絡をいただき、ありがとうございます。
下記の日程で伺うことが可能です。ご都合はいかがでしょうか。

・〇月〇日(〇) 00:00〜00:00
・〇月〇日(〇) 00:00〜00:00
・〇月〇日(〇) 00:00〜00:00

ご確認のほど、よろしくお願いいたします。`
      break
    case 'test':
      main = `適性検査のご案内をいただき、ありがとうございます。
期日までに受検いたします。`
      break
    case 'task':
      main = `ご案内いただき、ありがとうございます。
内容を確認のうえ、期日までに対応いたします。`
      break
    case 'result':
      main = `選考結果のご連絡をいただき、ありがとうございます。
内容を確認いたしました。`
      break
    default:
      main = `ご連絡いただき、ありがとうございます。
内容を確認いたしました。`
      break
  }

  return `${buildSalutation(email)}

お世話になっております。東北大学大学院の奥山彪太郎です。

${main}

引き続きよろしくお願いいたします。

${SIGNATURE}`
}

/** Claude API に渡すプロンプト(ローカル版 inbox/vite.claude-reply.ts と同一内容を保つ) */
export function promptFor(email: Record<string, unknown>): string {
  return `あなたは日本の新卒就活メールの返信文を作成するアシスタントです。
以下の受信メールに対する返信本文だけを、日本語で作成してください。

ルール:
- Markdownや解説は付けず、送信可能な返信本文だけを出力する
- 丁寧かつ簡潔にする
- 受信メールにない事実、日程、約束を勝手に作らない
- 日程や回答など本人の入力が必要な箇所は「〇月〇日」など明確なプレースホルダーにする
- 宛名は差出人情報から自然に作り、必ず「様」または「御中」を付ける
- 冒頭は「お世話になっております。東北大学大学院の奥山彪太郎です。」を基本とする
- 絵文字・顔文字は使わない
- 末尾には以下の署名をそのまま付ける

${SIGNATURE}

差出人: ${String(email.from ?? '')}
差出人メールアドレス: ${String(email.fromAddress ?? '')}
会社・組織: ${String(email.company ?? '')}
件名: ${String(email.subject ?? '')}
分類: ${String(email.category ?? '')}

受信メール本文:
${String(email.body ?? '')}`
}

/** Claude API(Messages API)を fetch 直叩きで呼ぶ。SDKは使わない */
async function generateWithClaude(email: Record<string, unknown>, apiKey: string): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), CLAUDE_TIMEOUT_MS)
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 1024,
        messages: [{ role: 'user', content: promptFor(email) }],
      }),
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`Claude APIがステータス ${response.status} を返しました`)
    }
    const data = (await response.json()) as {
      content?: { type: string; text?: string }[]
      stop_reason?: string
    }
    const text = (data.content ?? [])
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('')
      .trim()
    if (!text) {
      throw new Error('Claude APIから返信文が返りませんでした')
    }
    return text
  } finally {
    clearTimeout(timeout)
  }
}

/** リクエストボディをJSONとして読む(Vercelがパース済みなら req.body を使う) */
function readJson(req: IncomingMessage): Promise<unknown> {
  const parsed = (req as IncomingMessage & { body?: unknown }).body
  if (parsed !== undefined && parsed !== null) {
    return Promise.resolve(typeof parsed === 'string' ? JSON.parse(parsed) : parsed)
  }
  return new Promise((resolve, reject) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      body += chunk
      if (body.length > MAX_REQUEST_BYTES) reject(new Error('メール本文が長すぎます'))
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(body))
      } catch {
        reject(new Error('リクエストを読み取れませんでした'))
      }
    })
    req.on('error', reject)
  })
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'POSTのみ利用できます' }))
    return
  }

  let email: Record<string, unknown>
  try {
    const data = await readJson(req)
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('メールデータが不正です')
    }
    email = data as Record<string, unknown>
  } catch (error) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'リクエストが不正です' }))
    return
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (apiKey) {
    try {
      const body = await generateWithClaude(email, apiKey)
      res.end(JSON.stringify({ body }))
      return
    } catch {
      // 個人情報保護のためエラー詳細やメール内容はログに出さない。テンプレートへフォールバック
      console.warn('generate-reply: Claude API呼び出しに失敗したためテンプレートにフォールバックします')
    }
  }

  res.end(JSON.stringify({ body: buildReplyTemplate(email) }))
}
