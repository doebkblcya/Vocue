import { join } from 'node:path'
import { app, nativeTheme } from 'electron'
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
  showMainWindow,
  syncWindowThemeBackground,
} from './windows'

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  log.warn('Vocue 仅面向 Apple Silicon macOS')
}

let database: LocalDatabase | null = null
let session: InterviewSession | null = null
let quitting = false

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
  session.on('answer-log', (entries) => broadcast('session:answer-log', entries))
  registerIpc(database, settings, session)
  createMainWindow()

  app.on('activate', () => {
    showMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (!quitting) app.quit()
})

app.on('before-quit', (event) => {
  if (quitting) return
  event.preventDefault()
  quitting = true
  void (async () => {
    try {
      await session?.stop()
    } catch (error) {
      log.error('退出时清理会话失败', error)
    } finally {
      session = null
      try {
        database?.close()
      } catch (error) {
        log.error('退出时关闭数据库失败', error)
      } finally {
        database = null
        app.quit()
      }
    }
  })()
})
