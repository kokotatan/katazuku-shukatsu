// 画面へ渡すAPIはここに列挙したものだけ(任意のコマンド・ファイルパスは渡さない)
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('katazuku', {
  status: () => ipcRenderer.invoke('katazuku:status'),
  openDemo: () => ipcRenderer.invoke('katazuku:open-demo'),
  saveConfig: (input) => ipcRenderer.invoke('katazuku:save-config', input),
  chatgptSignIn: () => ipcRenderer.invoke('katazuku:chatgpt-signin'),
  chatgptStatus: () => ipcRenderer.invoke('katazuku:chatgpt-status'),
  dryRun: () => ipcRenderer.invoke('katazuku:dry-run'),
  setupCheck: () => ipcRenderer.invoke('katazuku:setup-check'),
  schedulePreview: () => ipcRenderer.invoke('katazuku:schedule-preview'),
  openDocs: (page) => ipcRenderer.invoke('katazuku:open-docs', page),
})
