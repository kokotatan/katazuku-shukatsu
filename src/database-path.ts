/** 正本DBの場所を一か所で決める。各スクリプトが別々の環境変数や相対パスを解釈しない。 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
export { resolveDatabasePath } from './data-path.js'

/** src/ からも dist/ からもリポジトリ(パッケージ)直下を指す */
const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

export function repositoryRoot(): string {
  return REPOSITORY_ROOT
}
