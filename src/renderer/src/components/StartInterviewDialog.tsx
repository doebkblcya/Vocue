import { Check, ChevronDown, Copy, FileText, Headphones, Mic, Search, Smartphone, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { formatStage } from '../../../shared/stage'
import type { AudioMode, CompanionConnectionState, PreparationSummary } from '../../../shared/types'
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
  const [source, setSource] = useState<'generic' | 'preparation'>(
    initialPreparationId ? 'preparation' : 'generic',
  )
  const [selectedId, setSelectedId] = useState<string | null>(initialPreparationId ?? null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<AudioMode>('system')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [companionBusy, setCompanionBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [companion, setCompanion] = useState<CompanionConnectionState>({
    active: false,
    url: '',
    qrDataUrl: '',
    connectedClients: 0,
  })

  useEffect(() => {
    let receivedLiveState = false
    const unsubscribe = window.vocue.companion.onState((state) => {
      receivedLiveState = true
      setCompanion(state)
    })
    void window.vocue.companion.getState().then((state) => {
      if (!receivedLiveState) setCompanion(state)
    })
    return unsubscribe
  }, [])

  const selectedPreparation = preparations.find((preparation) => preparation.id === selectedId)
  const filteredPreparations = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase('zh-CN')
    if (!keyword) return preparations
    return preparations.filter((preparation) =>
      preparation.name.toLocaleLowerCase('zh-CN').includes(keyword),
    )
  }, [preparations, query])

  const start = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await onStart(source === 'preparation' ? selectedId : null, mode)
    } catch (reason) {
      setError(getErrorMessage(reason))
      setBusy(false)
    }
  }

  const toggleCompanion = async (): Promise<void> => {
    setCompanionBusy(true)
    setError('')
    try {
      setCompanion(companion.active
        ? await window.vocue.companion.stop()
        : await window.vocue.companion.start())
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setCompanionBusy(false)
    }
  }

  const close = async (): Promise<void> => {
    if (companion.active) {
      try {
        await window.vocue.companion.stop()
      } catch {
        // 弹窗仍应能关闭；进程退出时还有统一清理。
      }
    }
    onClose()
  }

  const copyCompanionUrl = async (): Promise<void> => {
    try {
      await window.vocue.companion.copyUrl()
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch (reason) {
      setError(getErrorMessage(reason))
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
            <strong>回答依据</strong>
            <span>选择是否使用岗位、简历和补充资料</span>
          </div>
          <div className="source-picker">
            <button
              type="button"
              className={source === 'generic' ? 'selected' : ''}
              aria-pressed={source === 'generic'}
              onClick={() => {
                setSource('generic')
                setPickerOpen(false)
              }}
            >
              <span className="source-picker-icon"><Sparkles size={18} /></span>
              <span>
                <strong>通用方式</strong>
                <small>不使用面试档案，直接开始</small>
              </span>
              <span className="source-picker-check"><Check size={14} /></span>
            </button>
            <button
              type="button"
              className={source === 'preparation' ? 'selected' : ''}
              aria-pressed={source === 'preparation'}
              disabled={!preparations.length}
              onClick={() => {
                setSource('preparation')
                setPickerOpen(true)
              }}
            >
              <span className="source-picker-icon"><FileText size={18} /></span>
              <span>
                <strong>使用面试档案</strong>
                <small>{preparations.length ? '根据岗位和个人经历生成回答' : '还没有可用的面试档案'}</small>
              </span>
              <span className="source-picker-check"><Check size={14} /></span>
            </button>
          </div>

          {source === 'preparation' && (
            <div className="preparation-combobox">
              <button
                type="button"
                className={`preparation-combobox-trigger ${pickerOpen ? 'open' : ''}`}
                aria-expanded={pickerOpen}
                onClick={() => setPickerOpen((current) => !current)}
              >
                <span className="preparation-combobox-copy">
                  <strong>{selectedPreparation?.name ?? '选择一份面试档案'}</strong>
                  <small>
                    {selectedPreparation
                      ? `${formatStage(selectedPreparation.stage)} · ${selectedPreparation.hasResume ? '已选简历' : '未选简历'} · ${selectedPreparation.documentCount} 份补充资料`
                      : '可以输入公司或岗位名称进行搜索'}
                  </small>
                </span>
                <ChevronDown size={17} />
              </button>

              {pickerOpen && (
                <div className="preparation-combobox-menu">
                  <label className="preparation-search">
                    <Search size={15} />
                    <input
                      autoFocus
                      value={query}
                      placeholder="搜索公司或岗位"
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </label>
                  <div className="preparation-options" role="group" aria-label="面试档案">
                    {filteredPreparations.map((preparation) => (
                      <button
                        key={preparation.id}
                        type="button"
                        aria-pressed={selectedId === preparation.id}
                        className={selectedId === preparation.id ? 'selected' : ''}
                        onClick={() => {
                          setSelectedId(preparation.id)
                          setPickerOpen(false)
                          setQuery('')
                        }}
                      >
                        <span>
                          <strong>{preparation.name}</strong>
                          <small>
                            {formatStage(preparation.stage)} · {preparation.hasResume ? '已选简历' : '未选简历'} · {preparation.documentCount} 份补充资料
                          </small>
                        </span>
                        {selectedId === preparation.id && <Check size={15} />}
                      </button>
                    ))}
                    {!filteredPreparations.length && (
                      <p className="preparation-options-empty">没有找到匹配的面试档案</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

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

          <div className="companion-option">
            <div className="companion-option-copy">
              <span className="companion-option-icon"><Smartphone size={18} /></span>
              <span>
                <strong>手机伴侣</strong>
                <small>在同一局域网的手机上只读显示实时问题与建议回答</small>
              </span>
            </div>
            <button
              type="button"
              className={`toggle ${companion.active ? 'active' : ''}`}
              role="switch"
              aria-checked={companion.active}
              aria-label="开启手机伴侣"
              disabled={companionBusy || busy}
              onClick={() => void toggleCompanion()}
            >
              <span />
            </button>
          </div>

          {companion.active && (
            <div className="companion-pairing">
              <img src={companion.qrDataUrl} alt="手机伴侣连接二维码" />
              <div className="companion-pairing-copy">
                <strong>
                  {companion.connectedClients
                    ? `${companion.connectedClients} 台手机已连接`
                    : '使用手机扫码连接'}
                </strong>
                <p>手机和电脑需要连接同一个 Wi-Fi。面试结束后，此地址会立即失效。</p>
                <button type="button" onClick={() => void copyCompanionUrl()}>
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? '已复制' : '复制连接地址'}
                </button>
              </div>
            </div>
          )}

          {error && <div className="notice notice-error" role="alert">{error}</div>}
        </div>

        <footer className="dialog-actions">
          <button className="button ghost" disabled={busy} onClick={() => void close()}>取消</button>
          <button
            className="button primary"
            disabled={busy || companionBusy || (source === 'preparation' && !selectedId)}
            onClick={() => void start()}
          >
            {busy ? '正在准备面试…' : '开始面试'}
          </button>
        </footer>
      </section>
    </div>
  )
}
