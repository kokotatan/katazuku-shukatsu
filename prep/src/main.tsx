import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// smarthr-ui のスタイルは自前の index.css より先に読み込む。
// smarthr-ui.css には body/button などの素の要素リセットが含まれるため、
// あとから index.css(katazuku の配色トークン)を当てて既存の見た目を保つ。
import 'smarthr-ui/smarthr-ui.css'
import './index.css'
import { ThemeProvider, createTheme, IntlProvider } from 'smarthr-ui'
import App from './App'

// smarthr-ui のデフォルトテーマ(SmartHR Blue #0077c7 系)。独自色では上書きしない。
const theme = createTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <IntlProvider locale="ja">
      <ThemeProvider theme={theme}>
        <App />
      </ThemeProvider>
    </IntlProvider>
  </StrictMode>,
)
