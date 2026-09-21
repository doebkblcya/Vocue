import { ChevronRight, FileText, Pencil, Play } from 'lucide-react'
import { formatStage, nextStage } from '../../../shared/stage'
import type { PreparationSummary } from '../../../shared/types'

interface Props {
  preparation: PreparationSummary
  onEdit: () => void
  onStart: () => void
  /** 推进一轮：未设置 → AI 面 → 一面 → 二面 … */
  onAdvanceStage: () => void
}

export function ArchiveCard({
  preparation,
  onEdit,
  onStart,
  onAdvanceStage,
}: Props): React.JSX.Element {
  return (
    <article className="archive-card">
      <div className="archive-card-main">
        <span className="archive-card-icon"><FileText size={19} /></span>
        <span className="archive-card-copy">
          <strong>{preparation.name}</strong>
          <small>
            {preparation.hasResume ? '已选简历' : '未选简历'} · {preparation.documentCount} 份补充资料 · 更新于 {formatDate(preparation.updatedAt)}
          </small>
        </span>
      </div>
      <div className="archive-card-actions">
        <button
          className={`archive-card-stage ${preparation.stage === null ? 'unset' : ''}`}
          title={`推进到${formatStage(nextStage(preparation.stage))}`}
          onClick={onAdvanceStage}
        >
          <span>阶段</span>
          <strong>{formatStage(preparation.stage)}</strong>
          <ChevronRight size={14} />
        </button>
        <button className="button ghost small" onClick={onEdit}>
          <Pencil size={14} />编辑
        </button>
        <button className="button primary small archive-card-start" onClick={onStart}>
          <Play size={13} fill="currentColor" />开始面试
        </button>
      </div>
    </article>
  )
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(value))
}
