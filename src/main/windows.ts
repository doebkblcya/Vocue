import { join } from 'node:path'
import {
  BrowserWindow,
  desktopCapturer,
  nativeTheme,
  screen,
  shell,
  systemPreferences,
} from 'electron'
import { is } from '@electron-toolkit/utils'
import type { CapturePreview, VisibilityTestResult } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let floatingWindow: BrowserWindow | null = null
let captureProtectionEnabled = false
/** 面试态：主窗口退场，屏幕上只留置顶的提词浮窗 */
let interviewMode = false

const preloadPath = (): string => join(__dirname, '../preload/index.cjs')
const MAIN_WINDOW_SIZE = { width: 1120, height: 760 }
const FLOATING_WINDOW_SIZE = { width: 460, height: 560 }

function load(window: BrowserWindow, hash = ''): void {
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}${hash}`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash: hash.slice(1) } : {})
  }
}

export function createMainWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow
  const workArea = screen.getPrimaryDisplay().workAreaSize
  mainWindow = new BrowserWindow({
    width: Math.min(MAIN_WINDOW_SIZE.width, Math.floor(workArea.width * 0.9)),
    height: Math.min(MAIN_WINDOW_SIZE.height, Math.floor(workArea.height * 0.9)),
    minWidth: 640,
    minHeight: 460,
    titleBarStyle: 'hiddenInset',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0d10' : '#f3f4f1',
    show: false,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      sandbox: true,
    },
  })
  mainWindow.setContentProtection(captureProtectionEnabled)
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  load(mainWindow)
  return mainWindow
}

export function openFloatingWindow(): BrowserWindow {
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    floatingWindow.show()
    floatingWindow.focus()
    return floatingWindow
  }
  floatingWindow = new BrowserWindow({
    width: FLOATING_WINDOW_SIZE.width,
    height: FLOATING_WINDOW_SIZE.height,
    minWidth: 360,
    minHeight: 320,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      sandbox: true,
    },
  })
  floatingWindow.setAlwaysOnTop(true, 'floating')
  floatingWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  floatingWindow.setContentProtection(captureProtectionEnabled)
  floatingWindow.on('closed', () => {
    floatingWindow = null
  })
  load(floatingWindow, '#/floating')
  return floatingWindow
}

export function showMainWindow(): BrowserWindow {
  const window = createMainWindow()
  // 面试中不带工作台上台（点 Dock 图标也一样）：需要露面的永远是那一场的提词浮窗
  if (interviewMode) {
    openFloatingWindow()
    return window
  }
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  return window
}

export function closeFloatingWindow(): void {
  // 提词浮窗退场 = 面试结束，工作台连同它的档案管理和设置一起回到前台
  setInterviewMode(false)
  floatingWindow?.close()
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
}

/**
 * 进入／退出面试态。
 *
 * 进入时把主窗口收起来：面试期间需要操作的只有提词浮窗，
 * 工作台（档案管理、设置、再开一场）在这个场景下只会成为误操作的来源。
 * 退出统一走 closeFloatingWindow()，由它把主窗口带回来。
 */
export function setInterviewMode(active: boolean): void {
  interviewMode = active
  if (active && mainWindow && !mainWindow.isDestroyed()) mainWindow.hide()
}

export function minimizeFloatingWindow(): void {
  floatingWindow?.hide()
}

export function setCaptureProtection(enabled: boolean): void {
  captureProtectionEnabled = enabled
  for (const window of [mainWindow, floatingWindow]) {
    if (window && !window.isDestroyed()) window.setContentProtection(enabled)
  }
}

export function syncWindowThemeBackground(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#0b0d10' : '#f3f4f1')
  }
}

export async function captureVisibilityPreview(): Promise<VisibilityTestResult> {
  if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') === 'denied') {
    throw new Error('Electron 没有屏幕录制权限，请先在系统设置中开启后重试')
  }

  const originalProtection = captureProtectionEnabled
  try {
    setCaptureProtection(false)
    await waitForCaptureState()
    const unprotected = await captureScreens()

    setCaptureProtection(true)
    await waitForCaptureState()
    const protectedPreviews = await captureScreens()
    return { unprotected, protected: protectedPreviews }
  } finally {
    setCaptureProtection(originalProtection)
  }
}

export async function captureQuestionScreenshot(): Promise<{ dataUrl: string; displayName: string }> {
  if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') === 'denied') {
    throw new Error('Electron 没有屏幕录制权限，请先在系统设置中开启后重试')
  }

  const targetDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const visibleWindows = [mainWindow, floatingWindow].filter(
    (window): window is BrowserWindow => Boolean(window && !window.isDestroyed() && window.isVisible()),
  )

  try {
    // 即使用户关闭了 contentProtection，也不能让回答窗遮住待识别内容。
    for (const window of visibleWindows) window.hide()
    await waitForCaptureState()
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1600, height: 1000 },
      fetchWindowIcons: false,
    })
    const source = sources.find((item) => item.display_id === String(targetDisplay.id)) ?? sources[0]
    if (!source || source.thumbnail.isEmpty()) {
      throw new Error('没有获取到屏幕画面，请检查屏幕录制权限')
    }
    return {
      dataUrl: source.thumbnail.toDataURL(),
      displayName: source.name,
    }
  } finally {
    // 使用 showInactive，避免截图结束后抢走会议软件的键盘焦点。
    for (const window of visibleWindows) {
      if (!window.isDestroyed()) window.showInactive()
    }
  }
}

async function captureScreens(): Promise<CapturePreview[]> {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 1280, height: 800 },
    fetchWindowIcons: false,
  })
  if (!sources.length) throw new Error('没有获取到屏幕画面，请检查屏幕录制权限')
  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    dataUrl: source.thumbnail.toDataURL(),
  }))
}

function waitForCaptureState(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 250))
}

export function broadcast(channel: string, payload: unknown): void {
  for (const window of [mainWindow, floatingWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload)
  }
}
