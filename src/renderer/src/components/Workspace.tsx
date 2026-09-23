import { ArrowRight, Clock3, FileText, FolderPlus, Home, Library, Play, Settings } from 'lucide-react'
import { Fragment, useEffect, useRef, useState } from 'react'
import { formatRecordStage } from '../../../shared/interview-record'
import { formatStage, nextStage } from '../../../shared/stage'
import type { AudioMode, InterviewRecordSummary, PreparationStatus, PreparationSummary } from '../../../shared/types'
import { useSessionState } from '../hooks'
import { getErrorMessage } from '../error-message'
import { ArchiveCard } from './ArchiveCard'
import { ArchiveEditorDialog } from './ArchiveEditorDialog'
import { ConfirmDialog } from './ConfirmDialog'
import { LibraryView } from './LibraryView'
import { PageHeader } from './PageHeader'
import { StartInterviewDialog } from './StartInterviewDialog'
import { InterviewRecordView } from './InterviewRecordView'

interface Props {
  openSettings: () => void
}

type WorkspaceView = 'home' | 'archives' | 'library'

export function Workspace({ openSettings }: Props): React.JSX.Element {
  const [preparations, setPreparations] = useState<PreparationSummary[]>([])
  const [records, setRecords] = useState<InterviewRecordSummary[]>([])
  const [view, setView] = useState<WorkspaceView>('home')
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null)
  const [startOpen, setStartOpen] = useState(false)
  const [startPreparationId, setStartPreparationId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null | undefined>(undefined)
  /** 待确认的「推进一轮」目标；点档案卡上的阶段只是打开确认，不直接改 */
  const [pendingAdvance, setPendingAdvance] = useState<PreparationSummary | null>(null)
  const [pendingOutcome, setPendingOutcome] = useState<PreparationSummary | null>(null)
  const [archiveError, setArchiveError] = useState('')
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

  /**
   * 结束面试后直接打开这一场的复盘页，省掉用户再去侧栏找一次。
   * session.recordId 只在会话进行中存在（stop() 会把它清空），所以要提前记住。
   * 按住说话模式不建记录，没有可跳转的目标，这里自然跳过。
   */
  const finishedRecordId = useRef<string | null>(null)

  useEffect(() => {
    if (session.recordId) {
      finishedRecordId.current = session.recordId
      return
    }
    if (session.status !== 'idle' || !finishedRecordId.current) return
    const recordId = finishedRecordId.current
    finishedRecordId.current = null
    setView('home')
    setSelectedRecordId(recordId)
    void refresh()
  }, [session.recordId, session.status])

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

  /**
   * 档案卡上点阶段即可推进一轮，不用进编辑弹窗。
   * 不做乐观更新：写完回读一次，失败时界面停在真实阶段上。
   */
  const advanceStage = async (preparation: PreparationSummary): Promise<void> => {
    try {
      await window.vocue.preparations.setStage(preparation.id, nextStage(preparation.stage))
    } catch {
      // 本地库写入失败极少见，回读一次就能让界面回到真实状态
    }
    await refresh()
  }

  const changeStatus = async (id: string, status: PreparationStatus): Promise<void> => {
    setArchiveError('')
    await window.vocue.preparations.setStatus(id, status)
    await refresh()
  }

  const finishArchive = (preparation: PreparationSummary, status: 'passed' | 'rejected'): void => {
    setPendingOutcome(null)
    void changeStatus(preparation.id, status).catch((error: unknown) => {
      setArchiveError(getErrorMessage(error))
    })
  }

  const openView = (next: WorkspaceView): void => {
    setView(next)
    setSelectedRecordId(null)
  }

  const isActive = session.status !== 'idle'
  const recentRecord = records[0]
  const activePreparations = preparations.filter((preparation) => preparation.status === 'active')
  const finishedPreparations = preparations.filter((preparation) => preparation.status !== 'active')

  const renderArchive = (preparation: PreparationSummary): React.JSX.Element => (
    <ArchiveCard
      key={preparation.id}
      preparation={preparation}
      onEdit={() => setEditingId(preparation.id)}
      onStart={() => openStart(preparation.id)}
      onAdvanceStage={() => setPendingAdvance(preparation)}
      onFinish={() => setPendingOutcome(preparation)}
      onRestore={() => {
        void changeStatus(preparation.id, 'active').catch((error: unknown) => {
          setArchiveError(getErrorMessage(error))
        })
      }}
    />
  )

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
          <button
            className={`sidebar-row ${!selectedRecordId && view === 'library' ? 'selected' : ''}`}
            onClick={() => openView('library')}
          >
            <span className="row-icon"><Library size={16} /></span>
            <strong>文档库</strong>
          </button>
        </nav>

        <div className="sidebar-section-title"><span>面试记录</span><small>{records.length}</small></div>
        <div className="record-list">
          {groupRecords(records).map((group) => (
            <Fragment key={group.label}>
              <p className="sidebar-group-label">{group.label}</p>
              {group.records.map((record) => {
                const stageLabel = formatRecordStage(record.stage)
                return (
                  <button
                    key={record.id}
                    className={`sidebar-row record-row ${selectedRecordId === record.id ? 'selected' : ''}`}
                    onClick={() => setSelectedRecordId(record.id)}
                  >
                    <span className={`record-dot record-dot-${record.status}`} />
                    <span className="row-copy">
                      <strong>{record.preparationName}</strong>
                      <small>
                        {stageLabel && `${stageLabel} · `}
                        {record.status === 'recording'
                          ? '记录中'
                          : `${formatRecordDate(record.startedAt)} · ${record.utteranceCount} 段`}
                      </small>
                    </span>
                  </button>
                )
              })}
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
            <PageHeader eyebrow="VOCUE" title="工作台" />
            <div className="page-body workspace-dashboard">
              <section className="workspace-hero">
                <div className="workspace-hero-copy">
                  <span className="workspace-hero-kicker">LIVE ASSIST</span>
                  <h2>准备好后，从这里开始</h2>
                  <p>选择通用方式或一份面试档案，Vocue 会在独立悬浮窗中提供实时回答。</p>
                </div>
                <button className="button primary workspace-start" onClick={() => openStart()}>
                  <Play size={15} fill="currentColor" />开始面试
                </button>
              </section>

              <div className="workspace-overview">
                <section className="workspace-overview-card">
                  <span className="workspace-overview-icon"><FileText size={18} /></span>
                  <div className="workspace-overview-copy">
                    <span>面试档案</span>
                    <strong>
                      {activePreparations.length ? `${activePreparations.length} 份档案已就绪` : '还没有进行中的档案'}
                    </strong>
                    <small>
                      {activePreparations.length
                        ? '集中管理岗位 JD、简历和补充资料。'
                        : '创建档案后，回答会更贴合岗位和个人经历。'}
                    </small>
                  </div>
                  <button className="button secondary small" onClick={() => openView('archives')}>
                    {preparations.length ? '管理档案' : '创建档案'}<ArrowRight size={14} />
                  </button>
                </section>

                <section className="workspace-overview-card">
                  <span className="workspace-overview-icon"><Clock3 size={18} /></span>
                  <div className="workspace-overview-copy">
                    <span>最近一次面试</span>
                    <strong>{recentRecord?.preparationName ?? '还没有面试记录'}</strong>
                    <small>
                      {recentRecord
                        ? `${formatRecordDate(recentRecord.startedAt)} · ${recentRecord.utteranceCount} 段转写`
                        : '使用系统音频完成面试后，记录会出现在这里。'}
                    </small>
                  </div>
                  {recentRecord && (
                    <button
                      className="button secondary small"
                      onClick={() => setSelectedRecordId(recentRecord.id)}
                    >
                      查看记录<ArrowRight size={14} />
                    </button>
                  )}
                </section>
              </div>
            </div>
          </div>
        ) : view === 'archives' ? (
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
              {archiveError && <p className="notice notice-error" role="alert">{archiveError}</p>}
              {activePreparations.length ? (
                <section className="archive-section" aria-label="进行中的档案">
                  <div className="archive-section-heading">进行中 <span>{activePreparations.length}</span></div>
                  <div className="archive-list">{activePreparations.map(renderArchive)}</div>
                </section>
              ) : (
                <button className="archive-empty" onClick={() => setEditingId(null)}>
                  <span className="archive-card-icon"><FolderPlus size={20} /></span>
                  <span>
                    <strong>{finishedPreparations.length ? '创建新的面试档案' : '创建第一份面试档案'}</strong>
                    <small>可以先在「文档库」准备简历，再创建档案。</small>
                  </span>
                </button>
              )}
              {finishedPreparations.length > 0 && (
                <details className="archive-finished">
                  <summary>已结束档案 <span>{finishedPreparations.length}</span></summary>
                  <div className="archive-list">{finishedPreparations.map(renderArchive)}</div>
                </details>
              )}
            </div>
          </div>
        ) : (
          <LibraryView onChanged={refresh} />
        )}
      </section>

      {startOpen && (
        <StartInterviewDialog
          preparations={activePreparations}
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
      {pendingAdvance && (
        <ConfirmDialog
          title="推进面试阶段？"
          description={(
            <>
              「<strong>{pendingAdvance.name}</strong>」将从{' '}
              <strong>{formatStage(pendingAdvance.stage)}</strong> 推进到{' '}
              <strong>{formatStage(nextStage(pendingAdvance.stage))}</strong>。
              推错了可以在「编辑档案」里退回来。
            </>
          )}
          confirmLabel={`推进到${formatStage(nextStage(pendingAdvance.stage))}`}
          onCancel={() => setPendingAdvance(null)}
          onConfirm={() => {
            const preparation = pendingAdvance
            setPendingAdvance(null)
            void advanceStage(preparation)
          }}
        />
      )}
      {pendingOutcome && (
        <ConfirmDialog
          title="标记面试结果"
          description={<>「<strong>{pendingOutcome.name}</strong>」将移到已结束档案，之后可以随时恢复。</>}
          confirmLabel="已通过"
          secondaryAction={{ label: '未通过', onClick: () => finishArchive(pendingOutcome, 'rejected') }}
          onCancel={() => setPendingOutcome(null)}
          onConfirm={() => finishArchive(pendingOutcome, 'passed')}
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
