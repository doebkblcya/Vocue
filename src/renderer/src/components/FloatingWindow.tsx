import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, ChevronsDown, GripHorizontal, Headphones, Mic, Minus, RefreshCw, ScanLine, Square, TriangleAlert } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { isUnrecognizedSpeech } from '../../../shared/transcript'
import type { AnswerLogEntry } from '../../../shared/types'
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

  /**
   * 已完成的回答，由主进程在每条回答真正完成时才推一次。
   *
   * 生成照常在后台进行——界面显示哪一条完全不影响它。所以回看旧回答时，
   * 新问题照问、新回答照生成，切过去就是当下的样子（可能只有半截）。
   */
  const [answerLog, setAnswerLog] = useState<AnswerLogEntry[]>([])
  /** null = 看最新那条；数字 = 正在回看第几条 */
  const [viewIndex, setViewIndex] = useState<number | null>(null)

  useEffect(() => window.vocue.session.onAnswerLog((entries) => {
    setAnswerLog(entries)
    // 新的一场面试把列表清空了，回看位置也要跟着归零
    if (!entries.length) setViewIndex(null)
  }), [])

  const setRecording = useCallback(async (active: boolean): Promise<void> => {
    if (session.mode !== 'microphone') return
    // 上一段还在结算时不许开新的一段：那条连接的「句号」已经画过了，
    // 再按下去音频只会被无声丢掉。等胶囊回到「服务正常」再按。
    // 守卫放在这里而不是按钮上，是因为空格键不经过按钮。
    if (active && session.status === 'finalizing') return
    try {
      setMicError('')
      await microphoneCapture.setSending(active)
    } catch (error) {
      setMicError(getErrorMessage(error))
    }
  }, [session.mode, session.status])

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
    idle: '未开始', connecting: '正在连接', verifying: '正在检测识别服务', ready: '识别服务正常',
    listening: '正在聆听', recording: '录音中', finalizing: '正在识别',
    reconnecting: '正在重连', error: '出现问题',
  }[session.status]

  // 兜底再翻译一次：任何一路漏出来的技术错误都不该原样出现在界面上
  const errorText = micError ? getErrorMessage(micError) : session.error ? getErrorMessage(session.error) : ''

  // 面试官这一段没识别到：如实说，不要让候选人误以为面试官没说话
  const unrecognized = isUnrecognizedSpeech(session.partialTranscript || session.finalTranscript)

  // 「最新」当成排在最后一条之后的一格，这样回看时新回答到达不会把人挤走
  const liveIndex = answerLog.length
  const effectiveIndex = viewIndex === null ? liveIndex : Math.min(viewIndex, liveIndex)
  const browsing = effectiveIndex < liveIndex
  const shown = browsing ? answerLog[effectiveIndex] : null
  const questionText = shown ? shown.question : session.partialTranscript || session.finalTranscript
  const summaryText = shown ? shown.summary : session.answerSummary
  const detailText = shown ? shown.detail : session.answerDetail

  const goTo = (index: number): void => {
    const clamped = Math.max(0, Math.min(index, answerLog.length))
    setViewIndex(clamped >= answerLog.length ? null : clamped)
  }

  /**
   * 面试官的话封顶之后要跟住最新——但只在用户本来就贴着底部时跟。
   * 他往上翻看开头的时候，别每来一个字就把他拽回去。
   */
  const transcriptScroll = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  useEffect(() => {
    const node = transcriptScroll.current
    if (node && stickToBottom.current) node.scrollTop = node.scrollHeight
  }, [questionText])

  const handleTranscriptScroll = (): void => {
    const node = transcriptScroll.current
    if (!node) return
    stickToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24
  }

  // 上下方向键只在悬浮窗有焦点时才收得到——刻意不注册全局快捷键，
  // 否则等于把方向键从整个系统手里夺走。按钮才是主要入口，这只是补充。
  useEffect(() => {
    const keyDown = (event: KeyboardEvent): void => {
      if (event.code !== 'ArrowUp' && event.code !== 'ArrowDown') return
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      if (!answerLog.length) return
      event.preventDefault()
      setViewIndex((current) => {
        const at = current === null ? answerLog.length : Math.min(current, answerLog.length)
        const next = Math.max(0, Math.min(event.code === 'ArrowUp' ? at - 1 : at + 1, answerLog.length))
        return next >= answerLog.length ? null : next
      })
    }
    window.addEventListener('keydown', keyDown)
    return () => window.removeEventListener('keydown', keyDown)
  }, [answerLog.length])

  const verifying = localVerifying || session.status === 'verifying'
  // 只有「能重新检测」时才把胶囊渲染成按钮。
  // 其余状态是普通元素，从根上避免 disabled 的灰化波及它们。
  const canVerify =
    session.mode === 'microphone' && !verifying && ['ready', 'error'].includes(session.status)

  const statusContent = (
    <>
      {session.mode === 'microphone' ? <Mic size={14} /> : <Headphones size={14} />}
      <span>{verifying ? '正在检测识别服务' : status}</span>
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
          <div className="transcript-scroll" ref={transcriptScroll} onScroll={handleTranscriptScroll}>
            {unrecognized && !browsing ? (
              <p className="transcript-unrecognized">
                <TriangleAlert size={13} />
                这一段没有识别到，可以请面试官重复一遍
              </p>
            ) : (
              <p>{questionText || '等待问题…'}</p>
            )}
          </div>
        </section>

        <section className="answer-box">
          {answerLog.length > 0 && (
            <div className="answer-nav">
              <span className={`answer-nav-position ${browsing ? 'browsing' : ''}`}>
                {browsing ? `${effectiveIndex + 1} / ${answerLog.length}` : '最新'}
              </span>
              <div className="answer-nav-buttons">
                <button
                  title="上一条回答（↑）"
                  disabled={effectiveIndex <= 0}
                  onClick={() => goTo(effectiveIndex - 1)}
                >
                  <ChevronUp size={14} />
                </button>
                <button
                  title="下一条回答（↓）"
                  disabled={!browsing}
                  onClick={() => goTo(effectiveIndex + 1)}
                >
                  <ChevronDown size={14} />
                </button>
                <button
                  className={`answer-nav-latest ${browsing ? 'active' : ''}`}
                  title={session.generating ? '回到最新（后台正在生成新的回答）' : '回到最新'}
                  disabled={!browsing}
                  onClick={() => setViewIndex(null)}
                >
                  <ChevronsDown size={14} />
                </button>
              </div>
            </div>
          )}

          <div className="answer-scroll">
            {summaryText && (
              <div className="answer-summary">
                <span className="box-label">先说这几点</span>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{summaryText}</ReactMarkdown>
              </div>
            )}
            {detailText && (
              <div className="answer-detail">
                <span className="box-label">详细展开</span>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{detailText}</ReactMarkdown>
              </div>
            )}
            {!summaryText && !detailText && (
              <>
                <span className="box-label">建议回答</span>
                <p className="muted">
                  {browsing
                    ? '这条回答没有留下内容。'
                    : session.generating
                      ? '正在生成回答…'
                      : '识别到完整问题后，会在这里流式生成回答。'}
                </p>
              </>
            )}
          </div>
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
                disabled={session.status === 'finalizing'}
                title={session.status === 'finalizing' ? '上一句还在识别，稍等再按' : undefined}
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
                      : '按住听题'}
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
