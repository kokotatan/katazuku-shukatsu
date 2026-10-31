import { fileURLToPath } from 'node:url'
import { brokerFill, validatePortalId } from './lib.mjs'

function parseArgs(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (key === '--submit') {
      result.submit = true
      continue
    }
    if (!key.startsWith('--') || index + 1 >= argv.length) throw new Error(`引数が不正です: ${key}`)
    result[key.slice(2)] = argv[index + 1]
    index += 1
  }
  return result
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const portalId = validatePortalId(args.portal)
  const debugPort = Number(args['debug-port'])
  if (!Number.isInteger(debugPort) || debugPort < 1024 || debugPort > 65535) throw new Error('debug-portが不正です')
  const decision = {
    action: 'fill_credentials',
    portal_id: portalId,
    username_element: Number(args['username-element']),
    password_element: Number(args['password-element']),
    ...(args['submit-control'] == null ? {} : { submit_control: Number(args['submit-control']) })
  }
  const unprotectScript = fileURLToPath(new URL('./unprotect-credential.ps1', import.meta.url))
  const result = await brokerFill({
    portalId,
    credentialPath: args.credential,
    decision,
    debugPort,
    unprotectScript,
    submit: Boolean(args.submit)
  })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ status: 'error', message: error.message })}\n`)
  process.exitCode = 1
})
