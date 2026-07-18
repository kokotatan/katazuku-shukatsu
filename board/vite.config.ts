import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// katazuku.kotalabo.com のトップ(唯一の管理画面)として配信する
export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
})
