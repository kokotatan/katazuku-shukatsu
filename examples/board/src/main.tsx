import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { IntlProvider, ThemeProvider, createTheme } from 'smarthr-ui'
import 'smarthr-normalize-css'
import 'smarthr-ui/smarthr-ui.css'
import { App } from './App'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root が見つかりません')

createRoot(root).render(
  <StrictMode>
    <ThemeProvider theme={createTheme()}>
      <IntlProvider locale="ja">
        <App />
      </IntlProvider>
    </ThemeProvider>
  </StrictMode>,
)
