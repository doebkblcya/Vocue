import { join } from 'node:path'
import { app, dialog, nativeTheme } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { registerIpc } from './ipc/register'
import { configureLogFile, log } from './log'
import { MobileCompanionServer } from './companion/mobile-companion-server'
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
let companion: MobileCompanionServer | null = null
let quitting = false
let shutdown: Promise<void> | null = null
const SHUTDOWN_TIMEOUT_MS = 4_000

async function bootstrap(): Promise<void> {
  configureLogFile(join(app.getPath('logs'), 'vocue.log'))
  log.info('Vocue 主进程启动')
  electronApp.setAppUserModelId('com.vocue.desktop')
  app.on('browser-window-created', (_event, window) => optimizer.watchWindowShortcuts(window))

  database = new LocalDatabase(join(app.getPath('userData'), 'vocue.sqlite3'))
  const settings = new SettingsStore(database, join(app.getPath('userData'), 'secrets.json'))
  // 设置异步读取期间先使用安全默认值；窗口创建后，钥匙串弹窗不会再表现成应用假死。
  nativeTheme.themeSource = 'system'
  nativeTheme.on('updated', syncWindowThemeBackground)
  setCaptureProtection(true)
  session = new InterviewSession(database, settings)
  companion = new MobileCompanionServer()
  session.on('state', (state) => {
    broadcast('session:state', state)
    companion?.publishState(state)
  })
  session.on('answer-log', (entries) => {
    broadcast('session:answer-log', entries)
    companion?.publishAnswers(entries)
  })
  companion.on('state', (state) => broadcast('companion:state', state))
  registerIpc(database, settings, session, companion)
  createMainWindow()

  void settings.initialize().then(() => {
    const loaded = settings.getPublic()
    nativeTheme.themeSource = loaded.theme
    setCaptureProtection(loaded.hideFromScreenCapture)
    syncWindowThemeBackground()
    log.info('本机设置与钥匙串加载完成')
  }).catch((error: unknown) => {
    // 界面上的启动重试会再次触发 initialize()；这里不吞掉应用，也不阻塞退出。
    log.warn('读取本机设置失败，等待用户在启动页重试', error)
  })
}

async function shutdownApp(): Promise<void> {
  if (shutdown) return shutdown
  quitting = true
  shutdown = (async () => {
    log.info('开始退出清理')
    const cleanup = Promise.allSettled([
      session?.stop() ?? Promise.resolve(),
      companion?.stop() ?? Promise.resolve(),
    ])
    const completed = await completesWithin(cleanup, SHUTDOWN_TIMEOUT_MS)
    if (!completed) log.warn(`退出清理超过 ${SHUTDOWN_TIMEOUT_MS}ms，执行兜底退出`)
    else log.info('退出资源清理完成')

    if (completed) {
      try {
        database?.close()
      } catch (error) {
        log.error('退出时关闭数据库失败', error)
      }
    }
    session = null
    companion = null
    database = null
    log.info('Vocue 退出')
    // 清理完成或到达硬期限后立即结束；不再递归调用 app.quit() 触发第二轮事件。
    app.exit(0)
  })()
  return shutdown
}

function completesWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs)
    void promise.then(() => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

const primaryInstance = app.requestSingleInstanceLock()
if (!primaryInstance) {
  app.exit(0)
} else {
  app.on('second-instance', () => showMainWindow())
  app.on('activate', () => showMainWindow())

  void app.whenReady().then(bootstrap).catch((error: unknown) => {
    log.error('Vocue 启动失败', error)
    dialog.showErrorBox('Vocue 启动失败', error instanceof Error ? error.message : String(error))
    app.exit(1)
  })

  app.on('window-all-closed', () => {
    if (!quitting) app.quit()
  })

  app.on('before-quit', (event) => {
    event.preventDefault()
    void shutdownApp()
  })
}
