/** 正本DBの場所を一か所で決める。各スクリプトが別々の環境変数や相対パスを解釈しない。 */
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

export interface DatabasePathOptions {
  env?: NodeJS.ProcessEnv
  repositoryRoot?: string
}

/** 明示引数 > KATAZUKU_DB > 旧KATAZUKU_DB_PATH > private既定正本、の順。 */
export function resolveDatabasePath(explicitPath?: string, options: DatabasePathOptions = {}): string {
  const env = options.env ?? process.env
  const selected = explicitPath?.trim()
    || env.KATAZUKU_DB?.trim()
    || env.KATAZUKU_DB_PATH?.trim()
    || join(options.repositoryRoot ?? REPOSITORY_ROOT, 'data', 'katazuku.db')
  return selected === ':memory:' ? selected : resolve(selected)
}

export function repositoryRoot(): string {
  return REPOSITORY_ROOT
}
