import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { credentialRecordPath, readRegistry } from './settings.mjs'
import { validatePortalId } from './lib.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const script = fileURLToPath(new URL('./store-credential.ps1', import.meta.url))

function portalArgument(argv) {
  if (argv.length !== 2 || argv[0] !== '--portal') throw new Error('使い方: npm run local-login:credential -- --portal <id>')
  return validatePortalId(argv[1])
}

export async function credentialCommand(portalId, repositoryRoot = root) {
  const registry = await readRegistry(repositoryRoot)
  const portal = registry[portalId]
  if (!portal) throw new Error('登録済みのサービスがありません')
  if (portal.authMode !== 'password') throw new Error('SSO方式にはパスワードを登録しません')
  return ['powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-PortalId', portalId, '-AllowedUrl', portal.loginUrl,
    '-OutputPath', credentialRecordPath(repositoryRoot, portalId, portal),
  ]]
}

async function main() {
  if (process.platform !== 'win32') throw new Error('DPAPI資格情報登録はWindowsだけに対応しています')
  const portalId = portalArgument(process.argv.slice(2))
  await access(script)
  const [executable, args] = await credentialCommand(portalId)
  const code = await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, windowsHide: false, stdio: 'inherit' })
    child.once('error', reject)
    child.once('close', resolve)
  })
  if (code !== 0) throw new Error('資格情報を保存できませんでした')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1 })
}
