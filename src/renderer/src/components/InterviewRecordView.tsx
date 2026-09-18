import { BrainCircuit, Clock3, Eraser, RefreshCw, Undo2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { InterviewRecord } from '../../../shared/types'
import { getErrorMessage } from '../error-message'
import { PageHeader } from './PageHeader'

interface Props {
  recordId: string
  onBack: () => void
  onChanged: () => Promise<void>
}

export function InterviewRecordView({ recordId, onBack, onChanged }: Props): React.JSX.Element {
  const [record, setRecord] = useState<InterviewRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [reviewing, setReviewing] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    void window.vocue.interviews.get(recordId)
      .then((value) => {
        if (active) setRecord(value)
      })
      .catch((reason: unknown) => {
        if (active) setError(getErrorMessage(reason))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [recordId])

  useEffect(() => {
    if (record?.status !== 'recording') return
    const timer = window.setInterval(() => {
      void window.vocue.interviews.get(recordId).then((value) => {
        if (value) setRecord(value)
      })
    }, 2000)
    return () => window.clearInterval(timer)
  }, [record?.status, recordId])

  const generateReview = async (): Promise<void> => {
    setReviewing(true)
    setError('')
    try {
      setRecord(await window.vocue.interviews.generateReview(recordId))
      await onChanged()
    } catch (reason) {
      setError(getErrorMessage(reason))
      setRecord(await window.vocue.interviews.get(recordId))
    } finally {
      setReviewing(false)
    }
  }

  const toggleEchoCleanup = async (): Promise<void> => {
    setCleaning(true)
    setError('')
    try {
      const next = record?.echoCleanupApplied
        ? await window.vocue.interviews.undoEchoCleanup(recordId)
        : await window.vocue.interviews.cleanupEcho(recordId)
      setRecord(next)
      await onChanged()
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setCleaning(false)
    }
  }

  if (loading) return <div className="loading compact">正在读取面试记录…</div>
  if (!record) {
    return (
      <div className="page">
        <PageHeader
          eyebrow="INTERVIEW RECORD"
          title="面试记录"
          onBack={onBack}
          backTitle="返回工作台"
        />
        <div className="page-body record-missing">
          <p>{error || '这份面试记录不存在。'}</p>
          <button className="button secondary" onClick={onBack}>返回</button>
        </div>
      </div>
    )
  }

  const isRunning = record.status === 'recording'
  const visibleUtterances = record.utterances.filter((utterance) => !utterance.excludedAsEcho)
  const hasCandidateTranscript = record.utterances.some((utterance) => utterance.role === 'candidate')

  return (
    <div className="page">
      <PageHeader
        eyebrow="INTERVIEW RECORD"
        title={record.preparationName}
        onBack={onBack}
        backTitle="返回工作台"
        meta={(
          <>
            <span>{formatDateTime(record.startedAt)}</span>
            <span><Clock3 size={12} />{formatDuration(record.durationMs)}</span>
            <span>{record.utteranceCount} 段转写</span>
          </>
        )}
        action={(
          <span className={`record-status record-status-${record.status}`}>
            {statusLabel(record.status)}
          </span>
        )}
      />

      <div className="page-body fill">
        {error && <div className="notice notice-error">{error}</div>}
        {record.echoCleanupApplied && (
          <div className="echo-cleanup-summary">
            已清理外放回声：隐藏 {record.echoRemovedCount} 段，整理 {record.echoChangedCount} 段。原始记录仍然保留。
          </div>
        )}

      <div className="record-columns">
        <section className="record-panel transcript-panel">
          <header>
            <div><h2>完整文字记录</h2><span>按说话时间排列</span></div>
            {!isRunning && hasCandidateTranscript && (
              <button
                className="button secondary small"
                disabled={cleaning}
                onClick={() => void toggleEchoCleanup()}
                title={record.echoCleanupApplied ? '恢复未经清理的原始记录' : '移除麦克风中与面试官重复的外放声音'}
              >
                {cleaning
                  ? <RefreshCw size={14} className="spin" />
                  : record.echoCleanupApplied ? <Undo2 size={14} /> : <Eraser size={14} />}
                {cleaning ? '处理中…' : record.echoCleanupApplied ? '撤销清理' : '清理外放回声'}
              </button>
            )}
          </header>
          <div className="utterance-list">
            {visibleUtterances.length ? visibleUtterances.map((utterance) => (
              <article key={utterance.id} className={`utterance utterance-${utterance.role}`}>
                <time>{formatOffset(utterance.startMs)}</time>
                <div>
                  <strong>{utterance.role === 'interviewer' ? '面试官' : '我'}</strong>
                  <p>{utterance.cleanedText ?? utterance.text}</p>
                </div>
              </article>
            )) : (
              <p className="record-empty">{isRunning ? '面试进行中，终稿会陆续写入这里。' : '没有识别到可保存的内容。'}</p>
            )}
          </div>
        </section>

        <section className="record-panel review-panel">
          <header>
            <div><h2>AI 复盘</h2><span>基于双方完整转写</span></div>
            {!isRunning && record.utterances.length > 0 && (
              <button className="button primary small" disabled={reviewing} onClick={() => void generateReview()}>
                {reviewing ? <RefreshCw size={14} className="spin" /> : <BrainCircuit size={14} />}
                {reviewing ? '正在复盘…' : record.hasReview ? '重新生成' : '生成复盘'}
              </button>
            )}
          </header>
          {record.reviewMarkdown ? (
            <div className="review-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{record.reviewMarkdown}</ReactMarkdown>
            </div>
          ) : (
            <div className="review-empty">
              <BrainCircuit size={28} />
              <strong>{isRunning ? '结束面试后生成复盘' : '还没有生成复盘'}</strong>
              <span>{isRunning ? '完整转写正在持续保存。' : 'AI 会总结表现、问题和下一步准备建议。'}</span>
            </div>
          )}
          {record.reviewError && !error && <div className="notice notice-error">{record.reviewError}</div>}
        </section>
      </div>
      </div>
    </div>
  )
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value))
}

function formatDuration(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60_000)
  const seconds = Math.floor(milliseconds / 1000) % 60
  return minutes ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`
}

function formatOffset(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}

function statusLabel(status: InterviewRecord['status']): string {
  return {
    recording: '记录中',
    ready: '待复盘',
    reviewing: '复盘中',
    completed: '已复盘',
    incomplete: '记录不完整',
  }[status]
}
