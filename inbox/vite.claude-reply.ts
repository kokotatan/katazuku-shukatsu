import { spawn } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

const MAX_REQUEST_BYTES = 200_000

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
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

function promptFor(data: Record<string, unknown>): string {
  return `あなたは日本の新卒就活メールの返信文を作成するアシスタントです。
以下の受信メールに対する返信本文だけを、日本語で作成してください。

ルール:
- Markdownや解説は付けず、送信可能な返信本文だけを出力する
- 丁寧かつ簡潔にする
- 受信メールにない事実、日程、約束を勝手に作らない
- 日程や回答など本人の入力が必要な箇所は「〇月〇日」など明確なプレースホルダーにする
- 宛名は差出人情報から自然に作り、必ず「様」または「御中」を付ける
- 冒頭は「お世話になっております。東北大学大学院の奥山彪太郎です。」を基本とする
- 末尾には以下の署名をそのまま付ける

奥山彪太郎
東北大学大学院工学研究科ロボティクス専攻
平田・董研究室
修士1年
okuyama.kotaro.career@gmail.com
090-6746-0159

差出人: ${String(data.from ?? '')}
差出人メールアドレス: ${String(data.fromAddress ?? '')}
会社・組織: ${String(data.company ?? '')}
件名: ${String(data.subject ?? '')}
分類: ${String(data.category ?? '')}

受信メール本文:
${String(data.body ?? '')}`
}

function runClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // テキスト生成のみ(ツール不要)。--tools というフラグは存在しないので注意
    const child = spawn(
      'claude',
      ['-p', '--model', 'haiku', '--no-session-persistence'],
      {
        cwd: process.cwd(),
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error('Claude Code の返信生成が90秒でタイムアウトしました'))
    }, 90_000)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timeout)
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Claude Code が終了コード ${code} で失敗しました`))
        return
      }
      if (!stdout.trim()) {
        reject(new Error('Claude Code から返信文が返りませんでした'))
        return
      }
      resolve(stdout.trim())
    })

    child.stdin.end(prompt)
  })
}

async function handleReply(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'POSTのみ利用できます' }))
    return
  }

  try {
    const data = await readJson(req)
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('メールデータが不正です')
    }
    const body = await runClaude(promptFor(data as Record<string, unknown>))
    res.end(JSON.stringify({ body }))
  } catch (error) {
    res.statusCode = 500
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
  }
}

export function claudeReplyPlugin(): Plugin {
  const attach = (middlewares: { use: (path: string, handler: typeof handleReply) => void }) => {
    middlewares.use('/api/generate-reply', handleReply)
  }

  return {
    name: 'katazuku-claude-reply',
    configureServer(server) {
      attach(server.middlewares)
    },
    configurePreviewServer(server) {
      attach(server.middlewares)
    },
  }
}
