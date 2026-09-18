import { FileText, FolderPlus, Home, Play, Settings, Sparkles, Square } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AudioMode, InterviewRecordSummary, PreparationSummary } from '../../../shared/types'
import { useSessionState } from '../hooks'
import { ArchiveEditorDialog } from './ArchiveEditorDialog'
import { StartInterviewDialog } from './StartInterviewDialog'
import { InterviewRecordView } from './InterviewRecordView'

interface Props {
  openSettings: () => void
}

export function Workspace({ openSettings }: Props): React.JSX.Element {
  const [preparations, setPreparations] = useState<PreparationSummary[]>([])
  const [records, setRecords] = useState<InterviewRecordSummary[]>([])
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null)
  const [startOpen, setStartOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null | undefined>(undefined)
  const session = useSessionState()

  const refresh = async (): Promise<void> => {
    const [nextPreparations, nextRecords] = await Promise.all([
      window.vocue.preparations.list(),
      window.vocue.interviews.list(),
    ])
    setPreparations(nextPreparations)
    setRecords(nextRecords)
  }

  useEffect(() => {
    void refresh()
  }, [])

  useEffect(() => {
    if (session.status !== 'idle' && !session.recordId) return
    void window.vocue.interviews.list().then(setRecords)
  }, [session.status, session.recordId])

  const start = async (preparationId: string | null, mode: AudioMode): Promise<void> => {
    // 失败时直接向上抛，由开始面试弹窗展示错误，这里不做空转再抛
    await window.vocue.session.start(preparationId, mode)
    setStartOpen(false)
    setSelectedRecordId(null)
    await refresh()
  }

  const stop = async (): Promise<void> => {
    await window.vocue.session.stop()
    await window.vocue.window.closeFloating()
    await refresh()
  }

  const isActive = session.status !== 'idle'

  return (
    <main className="home-shell workspace-shell">
      <aside className="interview-sidebar">
        <div className="sidebar-brand drag-region">
          <div className="brand-mark small"><Sparkles size={17} /></div>
          <strong>Vocue</strong>
        </div>
        <button className="sidebar-home" onClick={() => setSelectedRecordId(null)}>
          <Home size={16} />工作台
        </button>
        <div className="sidebar-section-title"><span>面试记录</span><small>{records.length}</small></div>
        <nav className="record-list">
          {records.map((record) => (
            <button
              key={record.id}
              className={selectedRecordId === record.id ? 'selected' : ''}
              onClick={() => setSelectedRecordId(record.id)}
            >
              <span className={`record-dot record-dot-${record.status}`} />
              <span><strong>{record.preparationName}</strong><small>{formatRecordDate(record.startedAt)} · {record.utteranceCount} 段</small></span>
            </button>
          ))}
          {!records.length && <p className="sidebar-empty">完成第一场系统音频面试后，记录会出现在这里。</p>}
        </nav>
      </aside>

      <section className="workspace-main">
      <header className="home-header drag-region">
        <div className="home-brand">
          <p className="eyebrow">{selectedRecordId ? 'INTERVIEW RECORD' : 'WORKSPACE'}</p>
          <strong>{selectedRecordId ? '面试记录' : '工作台'}</strong>
        </div>
        <button className="home-settings no-drag" title="设置" onClick={openSettings}>
          <Settings size={18} />
        </button>
      </header>

      {selectedRecordId ? (
        <InterviewRecordView
          recordId={selectedRecordId}
          onBack={() => setSelectedRecordId(null)}
          onChanged={refresh}
        />
      ) : <div className="home-content">
        <section className="home-hero">
          {isActive ? (
            <>
              <span className="home-session-status">面试进行中 · {session.preparationName}</span>
              <div className="home-active-actions">
                <button className="home-start-button" onClick={() => void window.vocue.window.openFloating()}>
                  <Play size={18} fill="currentColor" />打开回答窗口
                </button>
                <button className="button secondary" onClick={() => void stop()}>
                  <Square size={14} />结束面试
                </button>
              </div>
            </>
          ) : (
            <>
              <button className="home-start-button" onClick={() => setStartOpen(true)}>
                <Play size={18} fill="currentColor" />开始面试
              </button>
              <span className="home-action-hint">选择面试档案和录音方式</span>
            </>
          )}
        </section>

        <section className="archive-section">
          <header>
            <div>
              <h2><FileText size={17} />面试档案</h2>
            </div>
            <button className="button secondary small" onClick={() => setEditingId(null)}>
              <FolderPlus size={16} />新建档案
            </button>
          </header>

          {preparations.length ? (
            <div className="archive-grid">
              {preparations.map((preparation) => (
                <button
                  key={preparation.id}
                  className="archive-card"
                  onClick={() => setEditingId(preparation.id)}
                >
                  <span className="archive-card-icon"><FileText size={19} /></span>
                  <span className="archive-card-copy">
                    <strong>{preparation.name}</strong>
                    <small>
                      {preparation.documentCount} 份补充资料 · {preparation.analyzed ? '已准备' : '待准备'}
                    </small>
                  </span>
                  <time>{formatDate(preparation.updatedAt)}</time>
                </button>
              ))}
            </div>
          ) : (
            <button className="archive-empty" onClick={() => setEditingId(null)}>
              <span className="archive-card-icon"><FolderPlus size={20} /></span>
              <span><strong>创建第一份面试档案</strong><small>添加 JD 和简历后，回答会更贴合你的经历。</small></span>
            </button>
          )}
        </section>
      </div>}
      </section>

      {startOpen && (
        <StartInterviewDialog
          preparations={preparations}
          onClose={() => setStartOpen(false)}
          onStart={start}
        />
      )}
      {editingId !== undefined && (
        <ArchiveEditorDialog
          preparationId={editingId}
          onClose={() => setEditingId(undefined)}
          onSaved={refresh}
        />
      )}
    </main>
  )
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(value))
}

function formatRecordDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}
