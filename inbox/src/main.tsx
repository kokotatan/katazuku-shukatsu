import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// 基本スタイルはindex.cssのbaseレイヤーに読み込み、アプリの文字色・余白を優先する。
import './index.css'
import { ThemeProvider, createTheme, IntlProvider } from 'smarthr-ui'
import App from './App'

// 基本部品はSmartHR、操作色はネクタイロゴの青。
const theme = createTheme({ color: { MAIN: '#005afd', TEXT_LINK: '#004bd6', BRAND: '#005afd', BACKGROUND: '#ffffff', BORDER: '#dedede', TEXT_BLACK: '#252525', TEXT_GREY: '#666666', OUTLINE: '#005afd' } })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <IntlProvider locale="ja">
      <ThemeProvider theme={theme}>
        <App />
      </ThemeProvider>
    </IntlProvider>
  </StrictMode>,
)
