import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * 正本DBの既定保存先を、ソースツリー外の利用者別データ領域へ決める。
 * 明示引数 > KATAZUKU_DB > 旧KATAZUKU_DB_PATH > OS既定の順。
 */
export function resolveDatabasePath(explicitPath?: string, env: NodeJS.ProcessEnv = process.env, platform = process.platform): string {
  const selected = explicitPath?.trim() || env.KATAZUKU_DB?.trim() || env.KATAZUKU_DB_PATH?.trim()
  if (selected) return selected === ':memory:' ? selected : resolve(selected)

  if (platform === 'win32') {
    const root = env.LOCALAPPDATA?.trim() || join(homedir(), 'AppData', 'Local')
    return resolve(root, 'katazuku', 'data', 'katazuku.db')
  }
  if (platform === 'darwin') return resolve(homedir(), 'Library', 'Application Support', 'katazuku', 'katazuku.db')
  return resolve(env.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share'), 'katazuku', 'katazuku.db')
}
