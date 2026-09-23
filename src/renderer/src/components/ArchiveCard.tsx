import { ChevronRight, FileText, Pencil, Play, RotateCcw } from 'lucide-react'
import { formatStage, nextStage } from '../../../shared/stage'
import type { PreparationSummary } from '../../../shared/types'

interface Props {
  preparation: PreparationSummary
  onEdit: () => void
  onStart: () => void
  /** 推进一轮：未设置 → AI 面 → 一面 → 二面 … */
  onAdvanceStage: () => void
  onFinish: () => void
  onRestore: () => void
}

export function ArchiveCard({
  preparation,
  onEdit,
  onStart,
  onAdvanceStage,
  onFinish,
  onRestore,
}: Props): React.JSX.Element {
  return (
    <article className="archive-card">
      <div className="archive-card-main">
        <span className="archive-card-icon"><FileText size={19} /></span>
        <span className="archive-card-copy">
          <strong>{preparation.name}</strong>
          {preparation.status !== 'active' && (
            <span className={`archive-outcome archive-outcome-${preparation.status}`}>
              {preparation.status === 'passed' ? '已通过' : '未通过'}
            </span>
          )}
          <small>
            {preparation.hasResume ? '已选简历' : '未选简历'} · {preparation.documentCount} 份补充资料 · 更新于 {formatDate(preparation.updatedAt)}
          </small>
        </span>
      </div>
      <div className="archive-card-actions">
        {preparation.status === 'active' ? (
          <button
            className={`archive-card-stage ${preparation.stage === null ? 'unset' : ''}`}
            title={`推进到${formatStage(nextStage(preparation.stage))}`}
            onClick={onAdvanceStage}
          >
            <span>阶段</span>
            <strong>{formatStage(preparation.stage)}</strong>
            <ChevronRight size={14} />
          </button>
        ) : <span className="archive-card-stage static"><span>阶段</span><strong>{formatStage(preparation.stage)}</strong></span>}
        <button className="button ghost small" onClick={onEdit}>
          <Pencil size={14} />编辑
        </button>
        {preparation.status === 'active' ? (
          <>
            <button className="button secondary small" onClick={onFinish}>标记结果</button>
            <button className="button primary small archive-card-start" onClick={onStart}>
              <Play size={13} fill="currentColor" />开始面试
            </button>
          </>
        ) : (
          <button className="button secondary small" onClick={onRestore}>
            <RotateCcw size={14} />恢复进行中
          </button>
        )}
      </div>
    </article>
  )
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(value))
}
