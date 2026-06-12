import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // katazuku.kotalab.com/status 配下で配信する
  base: '/status/',
  plugins: [react(), tailwindcss()],
})
