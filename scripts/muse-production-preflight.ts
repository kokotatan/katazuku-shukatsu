import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { parseJsonc, sha256, validateMuseProductionConfig } from '../src/muse-production.js'

const argument = process.argv.find((value) => value.startsWith('--config='))
const configPath = resolve(argument?.slice('--config='.length) || 'muse-gateway/wrangler.jsonc')

try {
  const source = readFileSync(configPath, 'utf8')
  const validation = validateMuseProductionConfig(parseJsonc(source))
  if (!validation.ok || !validation.manifest) {
    for (const error of validation.errors) console.error(`NG ${error}`)
    process.exitCode = 1
  } else {
    const evidence = {
      ...validation.manifest,
      configFile: basename(configPath),
      hashes: {
        redactedConfigSha256: sha256(source),
        workerSourceSha256: sha256(readFileSync(resolve('muse-gateway/worker.ts'))),
        packageLockSha256: sha256(readFileSync(resolve('muse-gateway/package-lock.json'))),
        mcpImplementationSha256: sha256(readFileSync(resolve('src/katazuku-mcp.ts'))),
        remotePolicySha256: sha256(readFileSync(resolve('src/katazuku-remote-policy.ts'))),
      },
      secretsRead: false,
      liveDeploymentVerified: false,
      note: 'この出力は設定とsourceの事前検査です。deploy、Meta提出、live endpoint検証を代替しません。',
    }
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
  }
} catch (error) {
  console.error(`NG production設定を検査できません: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
