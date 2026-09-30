/** 正本DBの場所を一か所で決める。各スクリプトが別々の環境変数や相対パスを解釈しない。 */
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** src/ からも dist/ からもリポジトリ(パッケージ)直下を指す */
const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 明示引数 > KATAZUKU_DB > 旧 KATAZUKU_DB_PATH > <リポジトリ>/data/katazuku.db の順。 */
export function resolveDatabasePath(explicitPath?: string, env: NodeJS.ProcessEnv = process.env): string {
  const selected = explicitPath?.trim()
    || env.KATAZUKU_DB?.trim()
    || env.KATAZUKU_DB_PATH?.trim()
    || join(REPOSITORY_ROOT, 'data', 'katazuku.db')
  return selected === ':memory:' ? selected : resolve(selected)
}

export function repositoryRoot(): string {
  return REPOSITORY_ROOT
}
