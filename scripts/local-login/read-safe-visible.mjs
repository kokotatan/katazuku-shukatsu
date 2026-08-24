// 隔離Chromeのログイン後ページから、input値を除いた可視テキストと同一originリンクだけを読む。
// 資格情報ブローカーのデバッグ補助。Cookie・storage・認証ヘッダー・フォーム値は取得しない。
import { readFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { clickSafeVisibleAction, navigateTarget, readSafeVisiblePage, urlWithinAllowedScope } from './lib.mjs'

function arg(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : ''
}

const portFile = arg('--port-file')
const origin = arg('--origin')
const prefix = arg('--prefix') || null
const navigateUrl = arg('--navigate-url') || ''
const clickActionText = arg('--click-action') || ''
if (!portFile || !origin) throw new Error('--port-file と --origin が必須です')

const port = Number((await readFile(portFile, 'utf8')).split(/\r?\n/)[0])
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('debug portが不正です')
if (navigateUrl) {
  if (!urlWithinAllowedScope(navigateUrl, origin, prefix)) throw new Error('navigate-urlが登録済みの適用範囲外です')
  await navigateTarget(port, origin, navigateUrl)
  await delay(1200)
}
if (clickActionText) {
  const clickAction = Number(clickActionText)
  await clickSafeVisibleAction(port, origin, prefix, clickAction)
  await delay(1200)
}
process.stdout.write(`${JSON.stringify(await readSafeVisiblePage(port, origin, prefix))}\n`)
