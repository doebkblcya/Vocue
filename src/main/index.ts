import { join } from 'node:path'
import { app, BrowserWindow, nativeTheme } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { registerIpc } from './ipc/register'
import { log } from './log'
import { InterviewSession } from './session/interview-session'
import { LocalDatabase } from './storage/database'
import { SettingsStore } from './storage/settings'
import {
  broadcast,
  createMainWindow,
  setCaptureProtection,
  syncWindowThemeBackground,
} from './windows'

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  log.warn('Vocue 仅面向 Apple Silicon macOS')
}

let database: LocalDatabase | null = null
let session: InterviewSession | null = null

void app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.vocue.desktop')
  app.on('browser-window-created', (_event, window) => optimizer.watchWindowShortcuts(window))

  database = new LocalDatabase(join(app.getPath('userData'), 'vocue.sqlite3'))
  const settings = new SettingsStore(database, join(app.getPath('userData'), 'secrets.json'))
  nativeTheme.themeSource = settings.get().theme
  nativeTheme.on('updated', syncWindowThemeBackground)
  setCaptureProtection(settings.get().hideFromScreenCapture)
  session = new InterviewSession(database, settings)
  session.on('state', (state) => broadcast('session:state', state))
  registerIpc(database, settings, session)
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => app.quit())

app.on('before-quit', () => {
  void session?.stop()
  database?.close()
  database = null
})
