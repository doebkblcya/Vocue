import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles/index.css'

const initialTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
document.documentElement.dataset.theme = initialTheme
document.documentElement.style.colorScheme = initialTheme

const root = createRoot(document.getElementById('root') as HTMLElement)

root.render(
  window.vocue ? (
    <StrictMode>
      <App />
    </StrictMode>
  ) : (
    <div className="loading">
      Vocue 启动失败：安全桥接未加载。请重新启动应用；如果仍然出现，请查看启动终端中的 preload
      错误。
    </div>
  ),
)
