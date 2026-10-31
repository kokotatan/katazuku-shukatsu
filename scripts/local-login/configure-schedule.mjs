import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createSettingsService } from './settings.mjs'
import { validatePortalId } from './lib.mjs'

const execFileAsync = promisify(execFile)
const root = fileURLToPath(new URL('../..', import.meta.url))
const scheduleScript = fileURLToPath(new URL('./schedule.ps1', import.meta.url))

function parseArgs(argv) {
  const result = { portalIds: [], enabled: null, time: '07:40' }
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (key === '--enable' || key === '--disable') {
      if (result.enabled !== null) throw new Error('--enableと--disableは同時に指定できません')
      result.enabled = key === '--enable'
      continue
    }
    if (!['--at', '--portal'].includes(key) || index + 1 >= argv.length) throw new Error('使い方: --enable|--disable --at HH:mm --portal <id> [...]')
    const value = argv[++index]
    if (key === '--at') result.time = value
    else result.portalIds.push(validatePortalId(value))
  }
  if (result.enabled === null) throw new Error('--enableまたは--disableを指定してください')
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(result.time)) throw new Error('時刻はHH:mmで指定してください')
  if (result.enabled && !result.portalIds.length) throw new Error('有効化には--portalを1件以上指定してください')
  return result
}

async function runSchedule(operation, { enabled = false, time = '07:40' } = {}) {
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scheduleScript, '-Operation', operation]
  if (operation === 'Apply') args.push('-At', time, ...(!enabled ? ['-Disabled'] : []))
  const { stdout } = await execFileAsync('powershell.exe', args, { cwd: root, windowsHide: true, encoding: 'utf8' })
  return operation === 'Read' ? JSON.parse(stdout.replace(/^\uFEFF/, '')) : null
}

async function main() {
  if (process.platform !== 'win32') throw new Error('定期実行の登録はWindowsだけに対応しています')
  const requested = parseArgs(process.argv.slice(2))
  const service = createSettingsService({
    root,
    readSchedule: () => runSchedule('Read'),
    applySchedule: (value) => runSchedule('Apply', value),
    storeCredential: async () => { throw new Error('この入口では資格情報を変更しません') },
    openLogin: async () => { throw new Error('この入口ではブラウザを開きません') },
  })
  const state = await service.state()
  const saved = await service.save({ preferences: { version: 1, enabled: requested.enabled, time: requested.time, portalIds: requested.portalIds }, revision: state.revision })
  process.stdout.write(JSON.stringify({ enabled: saved.preferences.enabled, time: saved.preferences.time, portalIds: saved.preferences.portalIds }) + '\n')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1 })
}
