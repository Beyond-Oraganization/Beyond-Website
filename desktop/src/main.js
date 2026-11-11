import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isTheApp, storeHandlers } from './bridge.js'
import { LocalDatabase } from './database.js'

/**
 * Beyond Bot on the desktop: the hosted app in its own window, so it updates whenever the site does, with a SQLite
 * file on this computer in place of the browser's storage. The page reaches the file only through the four
 * operations of preload.cjs.
 *
 * BEYOND_BOT_APP_URL and BEYOND_BOT_DATA_DIR point it elsewhere (the tests use a local app and a throwaway folder).
 */
const APP_URL = process.env.BEYOND_BOT_APP_URL ?? 'https://beyond-oraganization.github.io/Beyond-Website/app/'
const here = dirname(fileURLToPath(import.meta.url))

if (process.env.BEYOND_BOT_DATA_DIR) app.setPath('userData', process.env.BEYOND_BOT_DATA_DIR)

let database = null

/** Links that leave the app open in the person's browser, and only web links. */
function openOutside(url) {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
}

function openWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 900,
    title: 'Beyond Bot',
    webPreferences: { preload: join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (isTheApp(url, APP_URL)) return
    event.preventDefault()
    openOutside(url)
  })
  void window.loadURL(APP_URL)
}

app.whenReady().then(() => {
  database = new LocalDatabase(join(app.getPath('userData'), 'beyond-bot.sqlite'))
  for (const [channel, answer] of Object.entries(storeHandlers(database, APP_URL)))
    ipcMain.handle(channel, (event, store, key, value) => answer(event.senderFrame?.url ?? '', store, key, value))
  openWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow()
  })
})

app.on('window-all-closed', () => {
  database?.close()
  database = null
  app.quit()
})
