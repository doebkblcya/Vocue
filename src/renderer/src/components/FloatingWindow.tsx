import { useCallback, useEffect, useState } from 'react'
import { GripHorizontal, Headphones, Mic, Minus, RefreshCw, ScanLine, Square } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { microphoneCapture } from '../audio/microphone'
import { getErrorMessage } from '../error-message'
import { useSessionState } from '../hooks'
import { ConfirmDialog } from './ConfirmDialog'

export function FloatingWindow(): React.JSX.Element {
  const session = useSessionState()
  const [micError, setMicError] = useState('')
  const [localVerifying, setLocalVerifying] = useState(false)
  const [capturingScreen, setCapturingScreen] = useState(false)
  /** 截屏会离开本机，先问一次；确认框统一走 ConfirmDialog */
  const [confirmScreenshot, setConfirmScreenshot] = useState(false)

  const setRecording = useCallback(async (active: boolean): Promise<void> => {
    if (session.mode !== 'microphone') return
    try {
      setMicError('')
      await microphoneCapture.setSending(active)
    } catch (error) {
      setMicError(getErrorMessage(error))
    }
  }, [session.mode])

  const stopAndClose = async (): Promise<void> => {
    try {
      if (session.mode === 'system') await microphoneCapture.stopContinuous()
    } finally {
      await window.vocue.session.stop()
      await window.vocue.window.closeFloating()
    }
  }

  const reconnect = async (): Promise<void> => {
    try {
      setMicError('')
      await window.vocue.session.reconnect()
    } catch (error) {
      setMicError(getErrorMessage(error))
    }
  }

  /** 手动再检测一次语音识别服务，让用户自己确认服务是否正常 */
  const verify = async (): Promise<void> => {
    try {
      setMicError('')
      setLocalVerifying(true)
      await window.vocue.session.verify()
    } catch (error) {
      setMicError(getErrorMessage(error))
    } finally {
      setLocalVerifying(false)
    }
  }

  const askScreenshot = async (): Promise<void> => {
    setConfirmScreenshot(false)
    try {
      setMicError('')
      setCapturingScreen(true)
      await window.vocue.session.askScreenshot()
    } catch (error) {
      setMicError(getErrorMessage(error))
    } finally {
      setCapturingScreen(false)
    }
  }

  useEffect(() => {
    const keyDown = (event: KeyboardEvent): void => {
      if (event.code === 'Space' && !event.repeat && !(event.target instanceof HTMLInputElement)) {
        event.preventDefault()
        void setRecording(true)
      }
    }
    const keyUp = (event: KeyboardEvent): void => {
      if (event.code === 'Space') {
        event.preventDefault()
        void setRecording(false)
      }
    }
    const releaseOnBlur = (): void => void setRecording(false)
    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    window.addEventListener('blur', releaseOnBlur)
    return () => {
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
      window.removeEventListener('blur', releaseOnBlur)
    }
  }, [setRecording])

  useEffect(() => {
    if (session.mode !== 'system' || !session.recordingTranscript) return
    let active = true
    void microphoneCapture.startContinuous().catch((error: unknown) => {
      if (!active) return
      const message = getErrorMessage(error)
      setMicError(message)
      void window.vocue.session.reportRecordingProblem(message)
    })
    return () => {
      active = false
      void microphoneCapture.stopContinuous()
    }
  }, [session.mode, session.recordingTranscript])

  useEffect(() => () => {
    void microphoneCapture.stop()
  }, [])

  // 这个胶囊只描述「语音服务」状态，不含 AI 生成（生成是模型侧的事）
  const status = {
    idle: '未开始', connecting: '正在连接', verifying: '正在检测服务', ready: '服务正常',
    listening: '正在聆听', recording: '录音中', finalizing: '正在识别',
    reconnecting: '正在重连', error: '出现问题',
  }[session.status]

  // 兜底再翻译一次：任何一路漏出来的技术错误都不该原样出现在界面上
  const errorText = micError ? getErrorMessage(micError) : session.error ? getErrorMessage(session.error) : ''

  const verifying = localVerifying || session.status === 'verifying'
  // 只有「能重新检测」时才把胶囊渲染成按钮。
  // 其余状态是普通元素，从根上避免 disabled 的灰化波及它们。
  const canVerify =
    session.mode === 'microphone' && !verifying && ['ready', 'error'].includes(session.status)

  const statusContent = (
    <>
      {session.mode === 'microphone' ? <Mic size={14} /> : <Headphones size={14} />}
      <span>{verifying ? '正在检测服务' : status}</span>
      {canVerify && <RefreshCw size={12} className="status-refresh-icon" />}
      {verifying && <RefreshCw size={12} className="spin" />}
    </>
  )

  return (
    <div className="floating-shell">
      <header className="floating-header drag-region">
        <div className="floating-title"><GripHorizontal size={16} /><span>{session.preparationName || 'Vocue'}</span></div>
        <div className="floating-controls no-drag">
          <button title="最小化" onClick={() => void window.vocue.window.minimizeFloating()}><Minus size={15} /></button>
          <button title="结束面试" onClick={() => void stopAndClose()}><Square size={13} /></button>
        </div>
      </header>
      <div className="floating-body">
        {canVerify ? (
          <button
            type="button"
            className={`status-pill status-${session.status}`}
            title="点击重新检测语音识别服务"
            onClick={() => void verify()}
          >
            {statusContent}
          </button>
        ) : (
          <div
            className={`status-pill status-${session.status}`}
            title={session.error || '语音识别服务状态'}
          >
            {statusContent}
          </div>
        )}

        <section className="transcript-box">
          <span className="box-label">面试官</span>
          <p>{session.partialTranscript || session.finalTranscript || '等待问题…'}</p>
        </section>

        <section className="answer-box">
          {session.answerSummary && (
            <div className="answer-summary">
              <span className="box-label">先说这几点</span>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{session.answerSummary}</ReactMarkdown>
            </div>
          )}
          {session.answerDetail && (
            <div className="answer-detail">
              <span className="box-label">详细展开</span>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{session.answerDetail}</ReactMarkdown>
            </div>
          )}
          {!session.answerSummary && !session.answerDetail && (
            <>
              <span className="box-label">建议回答</span>
              <p className="muted">
                {session.generating ? '正在生成回答…' : '识别到完整问题后，会在这里流式生成回答。'}
              </p>
            </>
          )}
        </section>

        {/* 检测进行中时不显示任何旧错误：点了重新检测就进入 loading，
            上一次的失败提示立刻让位，避免「先报错再检测」的闪烁 */}
        {errorText && !verifying && (
          <div className="error-strip">
            <span title={errorText}>{errorText}</span>
            <button title="重新连接" onClick={() => void reconnect()}><RefreshCw size={14} /></button>
          </div>
        )}

        {session.status !== 'idle' && (
          <div className="floating-actions">
            <button
              className="screenshot-question no-drag"
              disabled={capturingScreen}
              title="截图会发送到 DeepSeek"
              onClick={() => setConfirmScreenshot(true)}
            >
              <ScanLine size={18} />
              {capturingScreen ? '正在截取…' : '截屏提问'}
            </button>
            {session.mode === 'microphone' && (
              <button
                className={`push-to-talk no-drag ${session.microphoneActive ? 'active' : ''}`}
                onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); void setRecording(true) }}
                onPointerUp={() => void setRecording(false)}
                onPointerCancel={() => void setRecording(false)}
              >
                <Mic size={19} />
                {session.microphoneActive
                  ? '松开结束'
                  : session.status === 'finalizing'
                    ? '正在识别刚才这句话…'
                    : session.generating
                      ? '打断并提问'
                      : '按住说话'}
              </button>
            )}
          </div>
        )}
      </div>

      {confirmScreenshot && (
        <ConfirmDialog
          title="截屏并发送？"
          description="将截取鼠标所在的整块屏幕并发送到 DeepSeek，用于识别题目。"
          confirmLabel="截取并发送"
          onCancel={() => setConfirmScreenshot(false)}
          onConfirm={() => void askScreenshot()}
        />
      )}
    </div>
  )
}
