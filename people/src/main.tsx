import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { IntlProvider, ThemeProvider, createTheme } from 'smarthr-ui'
import 'smarthr-normalize-css'
import 'smarthr-ui/smarthr-ui.css'
import '../../shared/src/digital.css'
import App from './App'

const root = document.getElementById('root')
if (!root) throw new Error('#root が見つかりません')

createRoot(root).render(
  <StrictMode>
    <ThemeProvider theme={createTheme({ color: { MAIN: '#0017c1', TEXT_LINK: '#0017c1', BRAND: '#0017c1', BACKGROUND: '#ffffff', BORDER: '#767676', TEXT_BLACK: '#1a1a1a', TEXT_GREY: '#595959', OUTLINE: '#0017c1' } })}>
      <IntlProvider locale="ja">
        <App />
      </IntlProvider>
    </ThemeProvider>
  </StrictMode>,
)
