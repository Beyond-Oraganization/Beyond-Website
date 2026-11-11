// The bridge the app sees as `window.beyondBotDesktop` (its DesktopBridge type): four database operations, each a
// message to the main process, which answers only the app's own pages. A sandboxed preload must be CommonJS.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('beyondBotDesktop', {
  storage: 'sqlite',
  get: (store, key) => ipcRenderer.invoke('store:get', store, key),
  set: (store, key, value) => ipcRenderer.invoke('store:set', store, key, value),
  delete: (store, key) => ipcRenderer.invoke('store:delete', store, key),
  keys: (store, prefix) => ipcRenderer.invoke('store:keys', store, prefix),
})
