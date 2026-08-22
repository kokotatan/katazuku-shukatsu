// @ts-check
/**
 * 正本DBなど、利用者固有データの保存先を決める。
 * ソースのチェックアウト内には既定で何も保存しない。
 */
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const APP_DIRECTORY = 'katazuku-shukatsu'

/**
 * @typedef {object} DataPathOptions
 * @property {NodeJS.Platform} [platform]
 * @property {NodeJS.ProcessEnv} [env]
 * @property {string} [home]
 */

/**
 * OSの規約に沿った、katazuku-shukatsu専用のデータディレクトリを返す。
 *
 * @param {DataPathOptions} [options]
 */
export function defaultDataDirectory(options = {}) {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const home = options.home ?? homedir()

  if (platform === 'win32') {
    return join(env.LOCALAPPDATA?.trim() || join(home, 'AppData', 'Local'), APP_DIRECTORY)
  }
  if (platform === 'darwin') {
    return join(home, 'Library', 'Application Support', APP_DIRECTORY)
  }
  return join(env.XDG_DATA_HOME?.trim() || join(home, '.local', 'share'), APP_DIRECTORY)
}

/**
 * 明示引数、環境変数、OS既定値の順で正本DBのパスを解決する。
 * KATAZUKU_DB_PATH は旧名との互換用。
 *
 * @param {string | undefined} [explicitPath]
 * @param {DataPathOptions} [options]
 */
export function resolveDatabasePath(explicitPath, options = {}) {
  const env = options.env ?? process.env
  const selected = explicitPath?.trim()
    || env.KATAZUKU_DB?.trim()
    || env.KATAZUKU_DB_PATH?.trim()
    || join(defaultDataDirectory(options), 'katazuku.db')
  return selected === ':memory:' ? selected : resolve(selected)
}

/**
 * 正本DBと同じデータ領域に置く、非公開写真の既定ディレクトリを返す。
 *
 * @param {string} databasePath
 */
export function privatePhotoDirectory(databasePath) {
  return join(dirname(resolve(databasePath)), 'private', 'photos')
}
