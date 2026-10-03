/** ローカル閲覧専用。リポジトリやログを静的配信せず、許可した画面とデータだけを返す。 */
import { createServer } from 'node:http'
import { readFile, realpath, readdir, stat } from 'node:fs/promises'
import { join, resolve, sep, extname } from 'node:path'

export const VIEWER_APPS = ['board', 'status', 'inbox', 'insight', 'profile', 'people', 'prep', 'impact']
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' }

export async function readBriefs(root, demo = false) {
  if (demo) return [
    { kind: 'asa', date: 'デモ', text: 'きょうのまとめ（架空）\n1. 未提出の誓約書を確認する\n2. 二次面接の候補日時を確認する\n送信・提出は本人が確認して行います。' },
    { kind: 'evening', date: 'デモ', text: '前夜の準備（架空）\n次の面接で説明する経験と、相手への質問を確認します。' },
  ]
  const dir = join(root, 'logs', 'briefs')
  const entries = await readdir(dir).catch(() => [])
  const result = []
  for (const kind of ['asa', 'evening']) {
    const name = entries.filter((entry) => new RegExp(`^${kind}-\\d{4}-\\d{2}-\\d{2}\\.local\\.md$`).test(entry)).sort().at(-1)
    if (!name) continue
    const path = join(dir, name)
    try {
      const resolved = await realpath(path)
      const base = await realpath(dir)
      if (!resolved.startsWith(base + sep) || (await stat(resolved)).size > 65_536) continue
      result.push({ kind, date: name.slice(kind.length + 1, kind.length + 11), text: await readFile(resolved, 'utf8') })
    } catch { /* 一時的に読めないものは次の再読込で確認する */ }
  }
  return result
}

export function createViewerServer({ root, demo = false, dataAvailable = true, briefsAvailable = dataAvailable }) {
  if (typeof root !== 'string' || !root) throw new Error('閲覧用のルートが必要です')
  const sourceName = demo ? 'snapshot.demo.json' : 'snapshot.json'
  const server = createServer(async (req, res) => {
    const port = server.address()?.port
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`]
    const origin = `http://${req.headers.host}`
    const send = (status, body, type = 'text/plain; charset=utf-8') => {
      res.writeHead(status, {
        'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY', 'Cross-Origin-Resource-Policy': 'same-origin',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      })
      res.end(req.method === 'HEAD' ? undefined : body)
    }
    const json = (status, value) => send(status, JSON.stringify(value), TYPES['.json'])
    if (!hosts.includes(req.headers.host) || (req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') {
      send(403, 'このPCからの閲覧だけを許可しています')
      return
    }
    if (!['GET', 'HEAD'].includes(req.method)) { send(405, '閲覧専用です'); return }
    if (!req.url?.startsWith('/') || req.url.startsWith('//')) { send(400, '不正なリクエストです'); return }
    let path
    try { path = decodeURIComponent(new URL(req.url, origin).pathname) } catch { send(400, '不正なパスです'); return }
    if (path.includes('\\') || path.includes('\0')) { send(400, '不正なパスです'); return }
    try {
      if (path === '/') {
        send(200, await readFile(join(root, 'tools', 'viewer-home.html')), TYPES['.html'])
        return
      }
      if (path === '/api/viewer') { json(200, { mode: demo ? 'demo' : 'local', automaticExecution: false }); return }
      if (path === '/api/briefs') { json(200, briefsAvailable ? await readBriefs(root, demo) : []); return }
      if (path === '/viewer-home.js') { send(200, await readFile(join(root, 'tools', 'viewer-home.js')), TYPES['.js']); return }
      const match = path.match(/^\/([a-z]+)\/(.*)$/)
      if (!match || !VIEWER_APPS.includes(match[1])) { send(404, 'ページが見つかりません'); return }
      const [, app, resource] = match
      if (resource === 'snapshot.json' || resource === 'snapshot.demo.json') {
        if (!dataAvailable) { json(404, { error: '指定した正本DBがありません。セットアップとDB指定を確認してください。' }); return }
        // modeを起動時に固定する。実データが無いときにデモへ黙って切り替えない。
        if (resource === 'snapshot.demo.json' && !demo) { json(404, { error: '自分のデータモードです。デモには切り替えません。' }); return }
        try {
          const viewerDemo = join(root, 'logs', 'viewer-demo.local.json')
          const source = demo && await stat(viewerDemo).then((entry) => entry.isFile()).catch(() => false)
            ? viewerDemo : join(root, app, 'public', sourceName)
          const snapshot = JSON.parse(await readFile(source, 'utf8'))
          if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || snapshot.demo !== demo) {
            json(409, { error: '閲覧データのモードが一致しません。正本DBからスナップショットを更新してください。' }); return
          }
          json(200, snapshot)
        } catch { json(404, { error: '正本DBのスナップショットはまだありません。セットアップと日次同期を確認してください。' }) }
        return
      }
      // Viteはpublicの実データもdistへコピーする。静的配信はビルドコードだけに限定する。
      const staticResource = resource || 'index.html'
      const assetType = extname(staticResource).toLowerCase()
      if (staticResource !== 'index.html' && (!staticResource.startsWith('assets/')
        || !['.js', '.css', '.svg', '.png', '.ico', '.woff', '.woff2', '.ttf'].includes(assetType))) {
        send(404, 'ページが見つかりません'); return
      }
      const base = await realpath(join(root, app, 'dist'))
      const candidate = resolve(base, staticResource)
      const allowedBase = staticResource === 'index.html' ? base : join(base, 'assets')
      if (!candidate.startsWith(allowedBase + sep)) { send(404, 'ページが見つかりません'); return }
      const file = await realpath(candidate)
      if (!file.startsWith(allowedBase + sep) || !(await stat(file)).isFile()) { send(404, 'ページが見つかりません'); return }
      send(200, await readFile(file), TYPES[extname(file)] || 'application/octet-stream')
    } catch { send(404, 'ページが見つかりません') }
  })
  return server
}
