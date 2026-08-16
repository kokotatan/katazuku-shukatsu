import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ボードは静的な「見る窓」なので、ビルド成果物をそのままファイルとして開ける形にする。
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
})
