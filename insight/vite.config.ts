import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // katazuku.kotalab.com/today 配下で配信する
  base: '/insight/',
  plugins: [react(), tailwindcss()],
})
