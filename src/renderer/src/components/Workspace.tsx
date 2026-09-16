import { FileText, FolderPlus, Play, Settings, Sparkles, Square } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AudioMode, PreparationSummary } from '../../../shared/types'
import { useSessionState } from '../hooks'
import { ArchiveEditorDialog } from './ArchiveEditorDialog'
import { StartInterviewDialog } from './StartInterviewDialog'

interface Props {
  openSettings: () => void
}

export function Workspace({ openSettings }: Props): React.JSX.Element {
  const [preparations, setPreparations] = useState<PreparationSummary[]>([])
  const [startOpen, setStartOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null | undefined>(undefined)
  const session = useSessionState()

  const refresh = async (): Promise<void> => {
    setPreparations(await window.vocue.preparations.list())
  }

  useEffect(() => {
    void refresh()
  }, [])

  const start = async (preparationId: string | null, mode: AudioMode): Promise<void> => {
    try {
      await window.vocue.session.start(preparationId, mode)
      setStartOpen(false)
      await refresh()
    } catch (error) {
      throw error
    }
  }

  const stop = async (): Promise<void> => {
    await window.vocue.session.stop()
    await window.vocue.window.closeFloating()
  }

  const isActive = session.status !== 'idle'

  return (
    <main className="home-shell">
      <header className="home-header drag-region">
        <div className="home-brand">
          <div className="brand-mark small"><Sparkles size={17} /></div>
          <strong>Vocue</strong>
        </div>
        <button className="home-settings no-drag" title="设置" onClick={openSettings}>
          <Settings size={18} />
        </button>
      </header>

      <div className="home-content">
        <section className="home-hero">
          {isActive ? (
            <>
              <span className="home-session-status">面试进行中 · {session.preparationName}</span>
              <div className="home-active-actions">
                <button className="home-start-button" onClick={() => void window.vocue.window.openFloating()}>
                  <Play size={18} fill="currentColor" />打开回答窗口
                </button>
                <button className="button secondary" onClick={() => void stop()}>
                  <Square size={14} />停止
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
      </div>

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
