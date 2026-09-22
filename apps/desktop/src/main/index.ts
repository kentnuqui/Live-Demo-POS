import { createRequire } from 'node:module'
import { join } from 'node:path'

const { app, BrowserWindow, ipcMain } = createRequire(import.meta.url)('electron') as typeof import('electron')
import { kickDrawer, printLines } from './hardware.js'
import { kvGet, kvSet, openLocalDb, outboxAdd, outboxFail, outboxList, outboxRemove } from './local-db.js'

function registerIpc(): void {
  ipcMain.handle('local:ping', () => openLocalDb())
  ipcMain.handle('local:kv-get', (_event, key: string) => kvGet(key))
  ipcMain.handle('local:kv-set', (_event, key: string, value: string) => kvSet(key, value))
  ipcMain.handle('local:outbox-add', (_event, entry) => outboxAdd(entry))
  ipcMain.handle('local:outbox-list', () => outboxList())
  ipcMain.handle('local:outbox-remove', (_event, id: string) => outboxRemove(id))
  ipcMain.handle('local:outbox-fail', (_event, id: string, message: string) => outboxFail(id, message))
  ipcMain.handle('hardware:print', (_event, address: string, lines: string[]) => printLines(address, lines))
  ipcMain.handle('hardware:drawer', (_event, address: string) => kickDrawer(address))
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#f6f3ee',
    title: 'Towns',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  await openLocalDb()
  registerIpc()
  createWindow()
  if (app.isPackaged) {
    try {
      const { autoUpdater } = await import('electron-updater')
      autoUpdater.autoDownload = false
      void autoUpdater.checkForUpdatesAndNotify()
    } catch (error) {
      console.error('Updater skipped', error)
    }
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
