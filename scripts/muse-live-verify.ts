import { verifyMuseLive } from '../src/muse-live.js'

const argument = process.argv.find((value) => value.startsWith('--origin='))
if (!argument) {
  console.error('NG --origin=https://production-origin が必要です')
  process.exitCode = 1
} else {
  try {
    const evidence = await verifyMuseLive(argument.slice('--origin='.length))
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
  } catch (error) {
    console.error(`NG live gatewayを確認できません: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
