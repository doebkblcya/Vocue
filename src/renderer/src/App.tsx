import { useEffect, useState } from 'react'
import { FloatingWindow } from './components/FloatingWindow'
import { SettingsPanel } from './components/SettingsPanel'
import { Workspace } from './components/Workspace'
import type { ThemeMode } from '../../shared/types'

export function App(): React.JSX.Element {
  const isFloating = window.location.hash === '#/floating'
  const [ready, setReady] = useState<boolean | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    if (!isFloating) void window.vocue.settings.isReady().then(setReady)
  }, [isFloating])

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
    void window.vocue.settings.get().then((settings) => setMode(settings.theme))
    const unsubscribe = window.vocue.settings.onChanged((settings) => setMode(settings.theme))
    return () => {
      media.removeEventListener('change', systemChanged)
      unsubscribe()
    }
  }, [])

  if (isFloating) return <FloatingWindow />
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
