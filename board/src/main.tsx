import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { IntlProvider, ThemeProvider, createTheme } from 'smarthr-ui'
import 'smarthr-normalize-css'
import './base.css'
import App from './App'

const LocalLoginSettings = lazy(() => import('./LocalLoginSettings'))
const localLogin = window.location.pathname.replace(/\/$/, '') === '/board/local-login'
  || new URLSearchParams(window.location.search).get('settings') === 'local-login'

const root = document.getElementById('root')
if (!root) throw new Error('#root が見つかりません')

createRoot(root).render(
  <StrictMode>
    <ThemeProvider theme={createTheme()}>
      <IntlProvider locale="ja">
        <Suspense fallback={<p role="status">設定画面を読み込んでいます…</p>}>
          {localLogin ? <LocalLoginSettings /> : <App />}
        </Suspense>
      </IntlProvider>
    </ThemeProvider>
  </StrictMode>,
)
