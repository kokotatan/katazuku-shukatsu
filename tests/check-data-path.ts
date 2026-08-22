import { dirname, isAbsolute, join, resolve } from 'node:path'
import { defaultDataDirectory, privatePhotoDirectory, resolveDatabasePath } from '../src/data-path.js'

let failures = 0
function check(name: string, ok: boolean): void {
  if (ok) console.log(`ok - ${name}`)
  else { console.error(`not ok - ${name}`); failures += 1 }
}

const emptyEnv = {} as NodeJS.ProcessEnv

check(
  'WindowsはLocalAppDataを使う',
  defaultDataDirectory({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\LocalData' }, home: 'C:\\Users\\Example' })
    === join('C:\\LocalData', 'katazuku-shukatsu'),
)
check(
  'WindowsはLocalAppData未設定時もホーム配下のOS領域を使う',
  defaultDataDirectory({ platform: 'win32', env: emptyEnv, home: 'HOME' })
    === join('HOME', 'AppData', 'Local', 'katazuku-shukatsu'),
)
check(
  'macOSはApplication Supportを使う',
  defaultDataDirectory({ platform: 'darwin', env: emptyEnv, home: 'HOME' })
    === join('HOME', 'Library', 'Application Support', 'katazuku-shukatsu'),
)
check(
  'LinuxはXDG_DATA_HOMEを使う',
  defaultDataDirectory({ platform: 'linux', env: { XDG_DATA_HOME: '/xdg' }, home: '/home/example' })
    === join('/xdg', 'katazuku-shukatsu'),
)
check(
  'LinuxはXDG_DATA_HOME未設定時に.local/shareを使う',
  defaultDataDirectory({ platform: 'linux', env: emptyEnv, home: '/home/example' })
    === join('/home/example', '.local', 'share', 'katazuku-shukatsu'),
)

const options = { platform: 'linux' as const, env: emptyEnv, home: '/home/example' }
const defaultDb = resolveDatabasePath(undefined, options)
check('DB既定値はソース相対ではなくOSデータ領域に置く', defaultDb === resolve('/home/example/.local/share/katazuku-shukatsu/katazuku.db'))
check('DB既定値は絶対パスになる', isAbsolute(defaultDb))
check('KATAZUKU_DBで既定値を上書きできる', resolveDatabasePath(undefined, { ...options, env: { KATAZUKU_DB: './custom.db' } }) === resolve('./custom.db'))
check('明示引数は環境変数より優先される', resolveDatabasePath('./explicit.db', { ...options, env: { KATAZUKU_DB: './custom.db' } }) === resolve('./explicit.db'))
check('旧KATAZUKU_DB_PATHも互換用に使える', resolveDatabasePath(undefined, { ...options, env: { KATAZUKU_DB_PATH: './legacy.db' } }) === resolve('./legacy.db'))
check(':memory:はパスへ変換しない', resolveDatabasePath(':memory:', options) === ':memory:')
check('写真はDBと同じデータ領域に置く', privatePhotoDirectory(defaultDb) === join(dirname(defaultDb), 'private', 'photos'))

if (failures) process.exit(1)
console.log('data-path tests passed')
