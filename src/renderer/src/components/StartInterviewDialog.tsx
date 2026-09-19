import { FileText, Headphones, Mic, Sparkles } from 'lucide-react'
import { useState } from 'react'
import type { AudioMode, PreparationSummary } from '../../../shared/types'
import { getErrorMessage } from '../error-message'

interface Props {
  preparations: PreparationSummary[]
  /** 从某份档案的「开始」按钮进来时预选该档案 */
  initialPreparationId?: string | null
  onClose: () => void
  onStart: (preparationId: string | null, mode: AudioMode) => Promise<void>
}

export function StartInterviewDialog({
  preparations,
  initialPreparationId,
  onClose,
  onStart,
}: Props): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(
    initialPreparationId ?? preparations[0]?.id ?? null,
  )
  const [mode, setMode] = useState<AudioMode>('system')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const start = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await onStart(selectedId, mode)
    } catch (reason) {
      setError(getErrorMessage(reason))
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="start-title">
      <section className="dialog-card start-dialog">
        <header className="dialog-header">
          <div>
            <p className="eyebrow">START INTERVIEW</p>
            <h2 id="start-title">开始面试</h2>
          </div>
        </header>

        <div className="dialog-content">
          <div className="field-heading">
            <strong>面试档案</strong>
            <span>用于生成更贴合岗位和简历的回答</span>
          </div>
          <div className="archive-picker">
            <button
              className={selectedId === null ? 'selected' : ''}
              onClick={() => setSelectedId(null)}
            >
              <span className="archive-picker-icon"><Sparkles size={17} /></span>
              <span><strong>通用面试</strong><small>不使用档案，直接开始</small></span>
            </button>
            {preparations.map((preparation) => (
              <button
                key={preparation.id}
                className={selectedId === preparation.id ? 'selected' : ''}
                onClick={() => setSelectedId(preparation.id)}
              >
                <span className="archive-picker-icon"><FileText size={17} /></span>
                <span><strong>{preparation.name}</strong><small>{preparation.documentCount} 份补充资料</small></span>
              </button>
            ))}
          </div>

          <div className="field-heading">
            <strong>录音模式</strong>
            <span>开始后仍可随时停止</span>
          </div>
          <div className="mode-picker">
            <button className={mode === 'system' ? 'selected' : ''} onClick={() => setMode('system')}>
              <Headphones size={22} />
              <span><strong>系统音频</strong><small>实时辅助，并保存双方完整文字记录</small></span>
            </button>
            <button
              className={mode === 'microphone' ? 'selected' : ''}
              onClick={() => setMode('microphone')}
            >
              <Mic size={22} />
              <span><strong>按住说话</strong><small>按住按钮听面试官提问，松开后生成回答</small></span>
            </button>
          </div>

          {mode === 'system' && (
            <div className="notice notice-info">
              将同时转写会议声音和你的麦克风，只在本地保存文字与时间点，不保存原始录音。
            </div>
          )}

          {error && <div className="notice notice-error" role="alert">{error}</div>}
        </div>

        <footer className="dialog-actions">
          <button className="button ghost" disabled={busy} onClick={onClose}>取消</button>
          <button className="button primary" disabled={busy} onClick={() => void start()}>
            {busy ? '正在准备面试…' : '开始'}
          </button>
        </footer>
      </section>
    </div>
  )
}
