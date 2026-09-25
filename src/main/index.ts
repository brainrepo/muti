import { app, BrowserWindow, session, shell } from 'electron'
import { join } from 'node:path'
import { registerIpc } from './ipc.ts'
import { setCacheDir } from './metadata/cache.ts'

const rendererUrl = process.env['ELECTRON_RENDERER_URL']

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 1024, minHeight: 680,
    backgroundColor: '#08111f',
    // barra integrata: su macOS i semafori stanno sopra il contenuto
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 14 } } : { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: '#08111f', symbolColor: '#8f9bb0', height: 44 } }),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  if (rendererUrl) void win.loadURL(rendererUrl)
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
}

// Nessuna navigazione fuori dall'app: i link https si aprono nel browser di sistema.
app.on('web-contents-created', (_e, wc) => {
  wc.on('will-navigate', (e, url) => {
    if (new URL(url).origin !== new URL(wc.getURL()).origin) e.preventDefault()
  })
  wc.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
})

void app.whenReady().then(async () => {
  setCacheDir(join(app.getPath('userData'), 'cache'))
  // ogni permesso richiesto dal renderer viene negato
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(false))
  registerIpc()
  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})

app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit())
