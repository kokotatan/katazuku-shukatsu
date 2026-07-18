import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { claudeReplyPlugin } from './vite.claude-reply'

export default defineConfig({
  // katazuku.kotalab.com/inbox 配下で配信する
  base: '/inbox/',
  plugins: [react(), tailwindcss(), claudeReplyPlugin()],
})
