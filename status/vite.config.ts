import { privateAssetsGuard } from '../tools/vite-private-assets.mjs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// セルフホスト先の /<app>/ 配下で配信できるよう、相対パスで出す。
export default defineConfig({
  base: './',
  plugins: [privateAssetsGuard(), react()],
  resolve: {
    alias: {
      // 共有層。ビルドせず TypeScript のまま読む(本体の構成と同じ)
      '@katazuku/data': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
      '@katazuku/ui': fileURLToPath(new URL('../shared/src/ui.tsx', import.meta.url)),
    },
    // shared/ は自分の node_modules を持たない。実体をアプリ側の1コピーへ固定する
    // (Reactが二重に読み込まれるとフックが壊れる)
    dedupe: ['react', 'react-dom', 'styled-components', 'smarthr-ui'],
  },
  build: { outDir: 'dist', emptyOutDir: true },
})
