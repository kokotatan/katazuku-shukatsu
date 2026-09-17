import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** PC設定画面の設定をCLIでも使う。値は表示・ログ出力しない。 */
export function desktopConfig(root = process.cwd()): { database: string; origin: string; sourceId: string; writeSecret: string } | null {
  const path = resolve(root, 'credentials/desktop-cloud.local.json')
  if (!existsSync(path)) return null
  let value: Record<string, unknown>
  try { value = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown> } catch { throw new Error('PCの保存先の設定を読み込めません。設定画面で確認してください。') }
  if (!value || ['database', 'origin', 'sourceId', 'writeSecret'].some(key => typeof value[key] !== 'string' || !value[key])) throw new Error('PCの保存先の初期設定を完了してください。')
  return { database: value.database as string, origin: value.origin as string, sourceId: value.sourceId as string, writeSecret: value.writeSecret as string }
}
