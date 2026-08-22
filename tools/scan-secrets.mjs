#!/usr/bin/env node
/**
 * scan-secrets: 公開してはいけない個人情報・秘密情報・SQLite DBの混入を検出する。
 *
 * このスクリプト自体には実名・実社名・実IDを一切書かない。検出は「PIIの形」で行う。
 * 固有名詞(実在の企業名・人名など)を弾きたい場合は、外部の遮断リストを渡す:
 *
 *   node tools/scan-secrets.mjs                     # 形ベースの検査のみ
 *   SCAN_BLOCKLIST=../private-blocklist.txt node tools/scan-secrets.mjs
 *
 * 遮断リストは1行1語のプレーンテキスト(# で始まる行はコメント)。
 * リポジトリには含めない(private 側にだけ置く)。マッチが1件でもあれば非ゼロ終了。
 */
import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, extname, relative } from 'node:path'

const ROOT = process.argv[2] ?? '.'
const SCAN_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.json', '.md', '.html', '.css', '.ps1', '.txt', '.yml', '.yaml'])
const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'build'])
const SKIP_FILE = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']) // 完全性ハッシュで誤検出するため除外

// 形ベースの検出パターン(実名を書かずにPIIの形を捕まえる)
const PATTERNS = [
  { name: 'メールアドレス', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    allow: /example\.(com|org|net)|you@example|@example\.com/i },
  { name: '電話番号(日本)', re: /\b0\d0-\d{4}-\d{4}\b/g },
  { name: '郵便番号(〒)', re: /〒\s*\d{3}-?\d{4}/g },
  { name: 'GoogleファイルID(シート/ドライブ)', re: /\b1[A-Za-z0-9_-]{30,}\b/g },
  { name: '秘密鍵ヘッダ', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: 'AWSアクセスキー', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'GitHubトークン', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { name: 'GoogleAPIキー', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'Slackトークン', re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g },
  { name: 'Slack Webhook', re: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/g },
  { name: 'Stripeシークレット', re: /\b(sk|rk)_live_[0-9A-Za-z]{16,}\b/g },
  { name: 'Anthropic APIキー', re: /\bsk-ant-[0-9A-Za-z_-]{20,}\b/g },
  { name: 'OpenAI APIキー', re: /\bsk-(proj-)?[0-9A-Za-z_-]{20,}\b/g },
  { name: 'JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: 'GoogleOAuthクライアント', re: /\b[0-9]+-[0-9a-z]{32}\.apps\.googleusercontent\.com\b/g },
]

// 外部遮断リスト(固有名詞。private 限定)
let blockTerms = []
if (process.env.SCAN_BLOCKLIST) {
  blockTerms = readFileSync(process.env.SCAN_BLOCKLIST, 'utf8')
    .split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
}

const hits = []
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    const st = statSync(p)
    if (st.isDirectory()) { if (!SKIP_DIR.has(entry)) walk(p) }
    else if (SCAN_EXT.has(extname(entry)) && !SKIP_FILE.has(entry)) scan(p)
  }
}
function scan(file) {
  const text = readFileSync(file, 'utf8')
  const lines = text.split(/\r?\n/)
  lines.forEach((line, i) => {
    for (const { name, re, allow } of PATTERNS) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(line))) {
        if (allow && allow.test(m[0])) continue
        hits.push({ file: relative(ROOT, file), line: i + 1, kind: name, sample: m[0] })
      }
    }
    for (const term of blockTerms) {
      if (line.includes(term)) hits.push({ file: relative(ROOT, file), line: i + 1, kind: '遮断語', sample: term })
    }
  })
}

// 拡張子を偽装したDBも、SQLiteのファイルヘッダで検出する。
// Git追跡対象だけを見るため、無視済みのローカルDBを日常の検査で誤検出しない。
function scanTrackedDatabases() {
  let tracked
  try {
    tracked = execFileSync('git', ['-C', ROOT, 'ls-files', '-z'], { encoding: 'utf8' })
  } catch {
    return // npm tarballなど、Git管理外での実行
  }
  for (const relativePath of tracked.split('\0').filter(Boolean)) {
    const file = join(ROOT, relativePath)
    let sqliteHeader = false
    try {
      const fd = openSync(file, 'r')
      try {
        const header = Buffer.alloc(16)
        sqliteHeader = readSync(fd, header, 0, header.length, 0) === header.length
          && header.equals(Buffer.from('SQLite format 3\0', 'utf8'))
      } finally {
        closeSync(fd)
      }
    } catch {
      continue
    }
    const databaseName = /\.(?:db|sqlite|sqlite3)(?:[-.](?:wal|shm|journal|backup|bak))?$/i.test(relativePath)
    if (sqliteHeader || databaseName) {
      hits.push({
        file: relativePath,
        line: 0,
        kind: sqliteHeader ? 'SQLiteデータベース' : 'データベース用拡張子',
        sample: 'Git追跡対象から除外してください',
      })
    }
  }
}

walk(ROOT)
scanTrackedDatabases()

if (hits.length) {
  console.error(`個人情報・秘密情報の疑いを ${hits.length} 件検出しました:\n`)
  for (const h of hits) console.error(`  ${h.file}${h.line ? `:${h.line}` : ''}  [${h.kind}]  ${h.sample}`)
  console.error('\n公開前に必ず解消してください。')
  process.exit(1)
}
console.log('scan-secrets: 検出なし' + (blockTerms.length
  ? `（形ベース + Git追跡SQLite + 遮断リスト ${blockTerms.length} 語）`
  : '（形ベース + Git追跡SQLite）'))
