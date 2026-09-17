import { assertPublicAssets } from './assert-private-assets.mjs'
import { resolve } from 'node:path'

/** publicはViteが無加工でコピーするため、ビルド開始前と生成後の両方を止める。 */
export function privateAssetsGuard() {
  let config
  return {
    name: 'katazuku-private-assets',
    configResolved(value) { config = value },
    buildStart() { if (config.publicDir) assertPublicAssets(config.publicDir, { source: true }) },
    closeBundle() { if (config.command === 'build') assertPublicAssets(resolve(config.root, config.build.outDir)) },
  }
}
