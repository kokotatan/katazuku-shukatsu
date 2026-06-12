import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // katazuku.kotalab.com/pipeline 配下で配信する
  base: '/pipeline/',
  plugins: [react(), tailwindcss()],
})
