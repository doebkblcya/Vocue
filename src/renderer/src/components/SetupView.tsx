import { useEffect, useState } from 'react'
import {
  AlertCircle,
  BrainCircuit,
  CheckCircle2,
  EyeOff,
  KeyRound,
  Laptop,
  LoaderCircle,
  Monitor,
  Moon,
  Radio,
  Sparkles,
  Sun,
  X,
} from 'lucide-react'
import type {
  AppSettings,
  PublicSettings,
  ThemeMode,
  ThinkingEffort,
  VisibilityTestResult,
} from '../../../shared/types'
import { getErrorMessage } from '../error-message'

interface Props {
  onComplete: () => void
  allowCancel?: boolean
}

const EMPTY: Partial<AppSettings> = {
  deepseekApiKey: '',
  doubaoApiKey: '',
}

type Feedback = {
  text: string
  tone: 'info' | 'success' | 'error'
}

export function SetupView({ onComplete, allowCancel = false }: Props): React.JSX.Element {
  const [publicSettings, setPublicSettings] = useState<PublicSettings | null>(null)
  const [form, setForm] = useState<Partial<AppSettings>>(EMPTY)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [busy, setBusy] = useState(false)
  const [visibilityTesting, setVisibilityTesting] = useState(false)
  const [showTestMarker, setShowTestMarker] = useState(false)
  const [visibilityResult, setVisibilityResult] = useState<VisibilityTestResult | null>(null)

  useEffect(() => {
    void window.vocue.settings.get().then((settings) => {
      setPublicSettings(settings)
      setForm({
        ...EMPTY,
        hideFromScreenCapture: settings.hideFromScreenCapture,
        theme: settings.theme,
        thinkingEffort: settings.thinkingEffort,
      })
    })
  }, [])

  const update = (key: keyof AppSettings, value: string): void =>
    setForm((current) => ({ ...current, [key]: value }))

  const selectTheme = async (theme: ThemeMode): Promise<void> => {
    setForm((current) => ({ ...current, theme }))
    try {
      const saved = await window.vocue.settings.save({ theme })
      setPublicSettings(saved)
    } catch (error) {
      setFeedback({
        text: getErrorMessage(error),
        tone: 'error',
      })
    }
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    setFeedback(null)
    try {
      const saved = await window.vocue.settings.save(form)
      setPublicSettings(saved)
      const ready = await window.vocue.settings.isReady()
      if (!ready) throw new Error('请同时配置 DeepSeek 和豆包语音识别凭证')
      setFeedback({ text: '配置已安全保存到本机', tone: 'success' })
      onComplete()
    } catch (error) {
      setFeedback({
        text: getErrorMessage(error),
        tone: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  const test = async (kind: 'deepseek' | 'doubao'): Promise<void> => {
    setBusy(true)
    setFeedback({ text: '正在测试连接…', tone: 'info' })
    try {
      await window.vocue.settings.save(form)
      const result =
        kind === 'deepseek'
          ? await window.vocue.settings.testDeepseek()
          : await window.vocue.settings.testDoubao()
      setFeedback({ text: result.message, tone: result.ok ? 'success' : 'error' })
    } catch (error) {
      setFeedback({
        text: getErrorMessage(error),
        tone: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  const testCaptureVisibility = async (): Promise<void> => {
    setVisibilityTesting(true)
    setShowTestMarker(true)
    setFeedback({ text: '正在分别捕获关闭保护和开启保护时的画面…', tone: 'info' })
    try {
      await waitForPaint()
      const result = await window.vocue.window.captureVisibilityPreview()
      setVisibilityResult(result)
      setFeedback({ text: '自检完成，请对比两组预览', tone: 'success' })
    } catch (error) {
      setFeedback({
        text: getErrorMessage(error),
        tone: 'error',
      })
    } finally {
      setShowTestMarker(false)
      setVisibilityTesting(false)
    }
  }

  if (!publicSettings) return <div className="loading">正在读取本地配置…</div>

  return (
    <main className="setup-shell">
      <section className="setup-card">
        <header className="setup-header">
          <div className="brand-mark"><Sparkles size={22} /></div>
          <div className="setup-heading">
            <p className="eyebrow">VOCUE</p>
            <h1>{allowCancel ? '设置' : '先完成一次简单设置'}</h1>
            <p className="muted">密钥使用 macOS 钥匙串加密后保存在本机，不经过任何自建服务器。</p>
          </div>
        </header>

        <div className="setup-content">
          <div className="provider-grid">
            <div className="setup-section">
              <div className="section-heading"><KeyRound size={18} /><strong>DeepSeek 官方 API</strong></div>
              <label>API Key</label>
              <input
                type="password"
                value={form.deepseekApiKey ?? ''}
                placeholder={publicSettings.hasDeepseekApiKey ? '已保存；留空则不修改' : 'sk-...'}
                onChange={(event) => update('deepseekApiKey', event.target.value)}
              />
              <div className="config-summary">
                <span>官方接口</span><strong>deepseek-flash</strong>
                <span>{form.thinkingEffort === 'disabled' ? '非思考模式' : `思考强度 · ${form.thinkingEffort}`}</span>
              </div>
              <button className="button secondary small" disabled={busy} onClick={() => void test('deepseek')}>测试 DeepSeek</button>
            </div>

            <div className="setup-section">
              <div className="section-heading"><Radio size={18} /><strong>火山引擎 · 豆包流式 ASR</strong></div>
              <label>新版 API Key</label>
              <input
                type="password"
                value={form.doubaoApiKey ?? ''}
                placeholder={publicSettings.hasDoubaoApiKey ? '已保存；留空则不修改' : '输入新版控制台的 API Key'}
                onChange={(event) => update('doubaoApiKey', event.target.value)}
              />
              <div className="config-summary">
                <span>流式识别 2.0</span><strong>Seed ASR</strong><span>仅支持新版 API Key</span>
              </div>
              <button className="button secondary small" disabled={busy} onClick={() => void test('doubao')}>测试豆包语音</button>
            </div>
          </div>

          <div className="preference-grid">
            <section className="theme-setting thinking-setting">
              <span className="privacy-icon"><BrainCircuit size={18} /></span>
              <span className="privacy-copy">
                <strong>回答思考强度</strong>
                <small>实时面试建议关闭或使用低强度；高强度和最大强度会明显增加首字延迟。</small>
              </span>
              <div className="theme-options" aria-label="回答思考强度">
                {([
                  ['disabled', '关闭'],
                  ['low', '低'],
                  ['high', '高'],
                  ['max', '最大'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`theme-option ${form.thinkingEffort === value ? 'selected' : ''}`}
                    aria-pressed={form.thinkingEffort === value}
                    onClick={() => setForm((current) => ({
                      ...current,
                      thinkingEffort: value as ThinkingEffort,
                    }))}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </section>

            <section className="theme-setting">
              <span className="privacy-icon"><Sun size={18} /></span>
              <span className="privacy-copy">
                <strong>外观主题</strong>
                <small>默认跟随 macOS，也可以固定使用浅色或深色。</small>
              </span>
              <div className="theme-options" aria-label="外观主题">
                {([
                  ['system', '跟随系统', Laptop],
                  ['light', '浅色', Sun],
                  ['dark', '深色', Moon],
                ] as const).map(([value, label, Icon]) => (
                  <button
                    key={value}
                    type="button"
                    className={`theme-option ${form.theme === value ? 'selected' : ''}`}
                    aria-pressed={form.theme === value}
                    onClick={() => void selectTheme(value)}
                  >
                    <Icon size={14} />
                    {label}
                  </button>
                ))}
              </div>
            </section>

            <button
              type="button"
              className="privacy-setting"
              role="switch"
              aria-checked={Boolean(form.hideFromScreenCapture)}
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  hideFromScreenCapture: !current.hideFromScreenCapture,
                }))
              }
            >
              <span className="privacy-icon"><EyeOff size={18} /></span>
              <span className="privacy-copy">
                <strong>在截图和录屏中隐藏窗口</strong>
                <small>系统截图和会议录屏不会捕获主窗口及回答窗口。</small>
              </span>
              <span className={`switch ${form.hideFromScreenCapture ? 'on' : ''}`} aria-hidden="true">
                <span />
              </span>
            </button>

            <section className="visibility-test-panel">
              <span className="privacy-icon"><Monitor size={18} /></span>
              <span className="privacy-copy">
                <strong>录屏可见性自检</strong>
                <small>对比“未保护 / 已保护”两组系统捕获预览，不会保存图片。</small>
              </span>
              <button
                className="button secondary small"
                disabled={busy || visibilityTesting}
                onClick={() => void testCaptureVisibility()}
              >
                {visibilityTesting ? '正在自检…' : '开始自检'}
              </button>
            </section>
          </div>

          {feedback && (
            <div className={`notice notice-${feedback.tone}`} role={feedback.tone === 'error' ? 'alert' : 'status'}>
              {feedback.tone === 'success' && <CheckCircle2 size={16} />}
              {feedback.tone === 'error' && <AlertCircle size={16} />}
              {feedback.tone === 'info' && <LoaderCircle className="spin" size={16} />}
              {feedback.text}
            </div>
          )}
        </div>

        <footer className="setup-actions">
          {allowCancel && <button className="button ghost" onClick={onComplete}>返回</button>}
          <button className="button primary" disabled={busy} onClick={() => void save()}>
            {busy ? '处理中…' : allowCancel ? '保存' : '保存并继续'}
          </button>
        </footer>
      </section>

      {showTestMarker && (
        <div className="capture-test-marker" aria-hidden="true">
          <span>VOCUE CAPTURE TEST</span>
          <strong>如果预览中能看到这张卡片，录屏也能看到 Vocue</strong>
        </div>
      )}

      {visibilityResult && (
        <div className="preview-backdrop" role="dialog" aria-modal="true" aria-label="录屏可见性自检结果">
          <section className="preview-dialog">
            <header>
              <div>
                <p className="eyebrow">CAPTURE VISIBILITY TEST</p>
                <h2>对比系统捕获结果</h2>
              </div>
              <button className="preview-close" title="关闭" onClick={() => setVisibilityResult(null)}>
                <X size={18} />
              </button>
            </header>
            <p className="preview-help">
              左侧应当看到绿色测试卡片。若右侧看不到，说明当前系统捕获遵守隐藏设置；若两侧都能看到，说明这条捕获链路会忽略窗口保护。
            </p>
            <div className="preview-columns">
              <PreviewColumn title="未保护 · 基准画面" previews={visibilityResult.unprotected} />
              <PreviewColumn title="已保护 · 隐藏测试" previews={visibilityResult.protected} />
            </div>
            <p className="preview-footnote">
              这项测试不会保存截图，也不能代表所有版本的 Teams 或腾讯会议；正式使用前仍建议在对应会议软件中复测。
            </p>
          </section>
        </div>
      )}
    </main>
  )
}

function PreviewColumn({
  title,
  previews,
}: {
  title: string
  previews: VisibilityTestResult['protected']
}): React.JSX.Element {
  return (
    <section className="preview-column">
      <strong>{title}</strong>
      {previews.map((preview) => (
        <figure key={preview.id}>
          <img src={preview.dataUrl} alt={`${title}：${preview.name}`} />
          <figcaption>{preview.name}</figcaption>
        </figure>
      ))}
    </section>
  )
}

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 120)))
  })
}
