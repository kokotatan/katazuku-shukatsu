import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // katazuku.kotalabo.com/impact 配下で配信する
  base: '/impact/',
  plugins: [react(), tailwindcss()],
})
