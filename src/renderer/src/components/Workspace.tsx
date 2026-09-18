import { FileText, FolderPlus, Home, Play, Settings, Square } from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'
import type { AudioMode, InterviewRecordSummary, PreparationSummary } from '../../../shared/types'
import { useSessionState } from '../hooks'
import { ArchiveCard } from './ArchiveCard'
import { ArchiveEditorDialog } from './ArchiveEditorDialog'
import { PageHeader } from './PageHeader'
import { StartInterviewDialog } from './StartInterviewDialog'
import { InterviewRecordView } from './InterviewRecordView'

interface Props {
  openSettings: () => void
}

type WorkspaceView = 'home' | 'archives'

export function Workspace({ openSettings }: Props): React.JSX.Element {
  const [preparations, setPreparations] = useState<PreparationSummary[]>([])
  const [records, setRecords] = useState<InterviewRecordSummary[]>([])
  const [view, setView] = useState<WorkspaceView>('home')
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null)
  const [startOpen, setStartOpen] = useState(false)
  const [startPreparationId, setStartPreparationId] = useState<string | null>(null)
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

  /** 传 null 是通用模式；传了档案则预先选中该档案 */
  const openStart = (preparationId: string | null = null): void => {
    setStartPreparationId(preparationId)
    setStartOpen(true)
  }

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

  const openView = (next: WorkspaceView): void => {
    setView(next)
    setSelectedRecordId(null)
  }

  const isActive = session.status !== 'idle'
  const recentPreparations = preparations.slice(0, 3)

  return (
    <main className="home-shell workspace-shell">
      {/* 全局顶栏：左边永久让给 macOS 交通灯，右边只放全局动作 */}
      <header className="titlebar">
        <div className="titlebar-actions">
          {isActive && (
            session.recordId ? (
              <button
                className="titlebar-session"
                title="查看这场面试"
                onClick={() => setSelectedRecordId(session.recordId)}
              >
                <span className="session-dot" />
                <span>{session.preparationName}</span>
              </button>
            ) : (
              <span className="titlebar-session">
                <span className="session-dot" />
                <span>{session.preparationName}</span>
              </span>
            )
          )}
          <button className="titlebar-icon-button" title="设置" onClick={openSettings}>
            <Settings size={17} />
          </button>
        </div>
      </header>

      {/* 侧栏只有一种元素：行。图标 = 去处，圆点 = 一条记录 */}
      <aside className="interview-sidebar">
        <nav className="sidebar-nav">
          <button
            className={`sidebar-row ${!selectedRecordId && view === 'home' ? 'selected' : ''}`}
            onClick={() => openView('home')}
          >
            <span className="row-icon"><Home size={16} /></span>
            <strong>工作台</strong>
          </button>
          <button
            className={`sidebar-row ${!selectedRecordId && view === 'archives' ? 'selected' : ''}`}
            onClick={() => openView('archives')}
          >
            <span className="row-icon"><FileText size={16} /></span>
            <strong>面试档案</strong>
          </button>
        </nav>

        <div className="sidebar-section-title"><span>面试记录</span><small>{records.length}</small></div>
        <div className="record-list">
          {groupRecords(records).map((group) => (
            <Fragment key={group.label}>
              <p className="sidebar-group-label">{group.label}</p>
              {group.records.map((record) => (
                <button
                  key={record.id}
                  className={`sidebar-row record-row ${selectedRecordId === record.id ? 'selected' : ''}`}
                  onClick={() => setSelectedRecordId(record.id)}
                >
                  <span className={`record-dot record-dot-${record.status}`} />
                  <span className="row-copy">
                    <strong>{record.preparationName}</strong>
                    <small>
                      {record.status === 'recording'
                        ? '记录中'
                        : `${formatRecordDate(record.startedAt)} · ${record.utteranceCount} 段`}
                    </small>
                  </span>
                </button>
              ))}
            </Fragment>
          ))}
          {!records.length && (
            <p className="sidebar-empty">还没有面试记录。完成第一场面试后，时间轴会出现在这里。</p>
          )}
        </div>
      </aside>

      <section className="workspace-main">
        {selectedRecordId ? (
          <InterviewRecordView
            recordId={selectedRecordId}
            onBack={() => setSelectedRecordId(null)}
            onChanged={refresh}
          />
        ) : view === 'home' ? (
          <div className="page">
            <PageHeader eyebrow="WORKSPACE" title="工作台" />
            <div className="page-body">
              <section className="session-card">
                {isActive ? (
                  <>
                    <div className="session-card-copy">
                      <span className="session-card-status"><span className="session-dot" />面试进行中</span>
                      <strong>{session.preparationName}</strong>
                      <small>回答窗口始终置顶；需要提词时唤出即可。</small>
                    </div>
                    <div className="session-card-actions">
                      <button
                        className="button primary"
                        onClick={() => void window.vocue.window.openFloating()}
                      >
                        <Play size={16} fill="currentColor" />打开回答窗口
                      </button>
                      <button className="button secondary" onClick={() => void stop()}>
                        <Square size={14} />结束面试
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="session-card-copy">
                      <strong>开始一场面试</strong>
                      <small>选择面试档案与录音方式，回答窗口会随后置顶出现。</small>
                    </div>
                    <div className="session-card-actions">
                      <button className="button primary" onClick={() => openStart()}>
                        <Play size={16} fill="currentColor" />开始面试
                      </button>
                    </div>
                  </>
                )}
              </section>

              <section className="archive-section">
                <header>
                  <h2><FileText size={17} />最近档案</h2>
                  <button className="button ghost small" onClick={() => openView('archives')}>
                    查看全部
                  </button>
                </header>
                {recentPreparations.length ? (
                  <div className="archive-grid">
                    {recentPreparations.map((preparation) => (
                      <ArchiveCard
                        key={preparation.id}
                        preparation={preparation}
                        onEdit={() => setEditingId(preparation.id)}
                        onStart={() => openStart(preparation.id)}
                      />
                    ))}
                  </div>
                ) : (
                  <button className="archive-empty" onClick={() => setEditingId(null)}>
                    <span className="archive-card-icon"><FolderPlus size={20} /></span>
                    <span>
                      <strong>创建第一份面试档案</strong>
                      <small>添加 JD 和简历后，回答会更贴合你的经历。</small>
                    </span>
                  </button>
                )}
              </section>
            </div>
          </div>
        ) : (
          <div className="page">
            <PageHeader
              eyebrow="ARCHIVES"
              title="面试档案"
              action={(
                <button className="button primary small" onClick={() => setEditingId(null)}>
                  <FolderPlus size={15} />新建档案
                </button>
              )}
            />
            <div className="page-body">
              {preparations.length ? (
                <div className="archive-grid">
                  {preparations.map((preparation) => (
                    <ArchiveCard
                      key={preparation.id}
                      preparation={preparation}
                      onEdit={() => setEditingId(preparation.id)}
                      onStart={() => openStart(preparation.id)}
                    />
                  ))}
                </div>
              ) : (
                <button className="archive-empty" onClick={() => setEditingId(null)}>
                  <span className="archive-card-icon"><FolderPlus size={20} /></span>
                  <span>
                    <strong>创建第一份面试档案</strong>
                    <small>添加 JD 和简历后，回答会更贴合你的经历。</small>
                  </span>
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      {startOpen && (
        <StartInterviewDialog
          preparations={preparations}
          initialPreparationId={startPreparationId}
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

interface RecordGroup {
  label: string
  records: InterviewRecordSummary[]
}

/** 记录会一直堆积，按时间分桶比一整条长列表好扫 */
function groupRecords(records: InterviewRecordSummary[]): RecordGroup[] {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfWeek = startOfToday - 6 * 86_400_000
  const groups: RecordGroup[] = [
    { label: '今天', records: [] },
    { label: '本周', records: [] },
    { label: '更早', records: [] },
  ]
  for (const record of records) {
    const startedAt = new Date(record.startedAt).getTime()
    if (startedAt >= startOfToday) groups[0].records.push(record)
    else if (startedAt >= startOfWeek) groups[1].records.push(record)
    else groups[2].records.push(record)
  }
  return groups.filter((group) => group.records.length)
}

function formatRecordDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}
