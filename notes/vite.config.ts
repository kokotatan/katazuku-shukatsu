import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // katazuku.kotalab.com/notes 配下で配信する
  base: '/notes/',
  plugins: [react(), tailwindcss()],
})
