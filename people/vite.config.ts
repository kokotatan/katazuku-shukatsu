import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // katazuku.kotalab.com/people 配下で配信する
  base: '/people/',
  plugins: [react(), tailwindcss()],
})
