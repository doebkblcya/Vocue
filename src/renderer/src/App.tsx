import { useCallback, useEffect, useState } from 'react'
import { FloatingWindow } from './components/FloatingWindow'
import { SettingsPanel } from './components/SettingsPanel'
import { Workspace } from './components/Workspace'
import type { ThemeMode } from '../../shared/types'
import { getErrorMessage } from './error-message'

const STARTUP_TIMEOUT_MS = 15_000

export function App(): React.JSX.Element {
  const isFloating = window.location.hash === '#/floating'
  const [ready, setReady] = useState<boolean | null>(null)
  const [startupError, setStartupError] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)

  const loadStartup = useCallback(async (): Promise<void> => {
    if (isFloating) return
    setReady(null)
    setStartupError('')
    try {
      setReady(await withTimeout(window.vocue.settings.isReady(), STARTUP_TIMEOUT_MS))
    } catch (error) {
      setStartupError(getErrorMessage(
        error,
        '无法读取本机设置。请完成 macOS 钥匙串授权后重试。',
      ))
    }
  }, [isFloating])

  useEffect(() => {
    void loadStartup()
  }, [loadStartup])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    let currentMode: ThemeMode = 'system'
    const apply = (): void => {
      const resolved = currentMode === 'system' ? (media.matches ? 'dark' : 'light') : currentMode
      document.documentElement.dataset.theme = resolved
      document.documentElement.style.colorScheme = resolved
    }
    const setMode = (mode: ThemeMode): void => {
      currentMode = mode
      apply()
    }
    const systemChanged = (): void => {
      if (currentMode === 'system') apply()
    }
    media.addEventListener('change', systemChanged)
    void window.vocue.settings.get().then((settings) => setMode(settings.theme)).catch(() => undefined)
    const unsubscribe = window.vocue.settings.onChanged((settings) => setMode(settings.theme))
    return () => {
      media.removeEventListener('change', systemChanged)
      unsubscribe()
    }
  }, [])

  if (isFloating) return <FloatingWindow />
  if (startupError) {
    return (
      <div className="startup-error">
        <strong>Vocue 启动未完成</strong>
        <p>{startupError}</p>
        <button className="button primary" onClick={() => void loadStartup()}>重试</button>
      </div>
    )
  }
  if (ready === null) return <div className="loading">正在启动 Vocue…</div>
  // 首次配置还没有主界面可回，必须是整页
  if (!ready) return <SettingsPanel variant="onboarding" onComplete={() => setReady(true)} />
  // 日常设置覆盖在主界面之上：Workspace 保持挂载，选中项和所在页面都不会丢
  return (
    <>
      <Workspace openSettings={() => setSettingsOpen(true)} />
      {settingsOpen && (
        <SettingsPanel
          variant="dialog"
          onComplete={() => setSettingsOpen(false)}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </>
  )
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('读取本机设置超时，请解锁 macOS 登录钥匙串后重试'))
    }, timeoutMs)
    void promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
