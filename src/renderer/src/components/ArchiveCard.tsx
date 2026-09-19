import { FileText, Play } from 'lucide-react'
import { formatStage, nextStage } from '../../../shared/stage'
import type { PreparationSummary } from '../../../shared/types'

interface Props {
  preparation: PreparationSummary
  onEdit: () => void
  onStart: () => void
  /** 推进一轮：未设置 → AI 面 → 一面 → 二面 … */
  onAdvanceStage: () => void
}

/**
 * 卡片主体进编辑，动作按钮独立。
 * 不用嵌套 button，避免出现「点卡片还是点按钮」的歧义。
 */
export function ArchiveCard({
  preparation,
  onEdit,
  onStart,
  onAdvanceStage,
}: Props): React.JSX.Element {
  return (
    <article className="archive-card">
      <button className="archive-card-main" onClick={onEdit}>
        <span className="archive-card-icon"><FileText size={19} /></span>
        <span className="archive-card-copy">
          <strong>{preparation.name}</strong>
          <small>
            {preparation.hasResume ? '已选简历' : '未选简历'} · {preparation.documentCount} 份补充资料
          </small>
        </span>
        <time>{formatDate(preparation.updatedAt)}</time>
      </button>
      <button
        className={`archive-card-stage ${preparation.stage === null ? 'unset' : ''}`}
        title={`点击进入${formatStage(nextStage(preparation.stage))}`}
        onClick={onAdvanceStage}
      >
        {formatStage(preparation.stage)}
      </button>
      <button className="archive-card-start" title="用这份档案开始面试" onClick={onStart}>
        <Play size={14} fill="currentColor" />
      </button>
    </article>
  )
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(value))
}
