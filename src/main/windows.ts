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

const preloadPath = (): string => join(__dirname, '../preload/index.mjs')
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
      sandbox: false,
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
      sandbox: false,
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

export function closeFloatingWindow(): void {
  floatingWindow?.close()
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
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
