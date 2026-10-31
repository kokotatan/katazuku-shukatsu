/** 起動用JavaScriptからも、正本DBの保存先を共通の規則で読む。DBは開かない。 */
import { resolveDatabasePath } from '../src/data-path.js'
process.stdout.write(resolveDatabasePath())
