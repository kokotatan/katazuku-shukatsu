import { ViewerClient, CONNECTION_CHANGE_KEY } from '../../src/viewer-client'
export { ViewerError } from '../../src/viewer-client'
let storage: Storage | undefined
try { storage = window.sessionStorage } catch { /* 保存を許可していないブラウザ */ }
export const viewer = new ViewerClient({ storage, broadcast() {
  try { window.localStorage.setItem(CONNECTION_CHANGE_KEY, crypto.randomUUID()) } catch { /* 同じタブは解除済み */ }
} })
window.addEventListener('storage', event => { if (event.key === CONNECTION_CHANGE_KEY) viewer.invalidate(false) })
window.addEventListener('pageshow', () => viewer.checkExpiry())
document.addEventListener('visibilitychange', () => { if (!document.hidden) viewer.checkExpiry() })
