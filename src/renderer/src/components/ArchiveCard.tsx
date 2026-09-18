import { FileText, Play } from 'lucide-react'
import type { PreparationSummary } from '../../../shared/types'

interface Props {
  preparation: PreparationSummary
  onEdit: () => void
  onStart: () => void
}

/**
 * 卡片主体进编辑，动作按钮独立。
 * 不用嵌套 button，避免出现「点卡片还是点按钮」的歧义。
 */
export function ArchiveCard({ preparation, onEdit, onStart }: Props): React.JSX.Element {
  return (
    <article className="archive-card">
      <button className="archive-card-main" onClick={onEdit}>
        <span className="archive-card-icon"><FileText size={19} /></span>
        <span className="archive-card-copy">
          <strong>{preparation.name}</strong>
          <small>
            {preparation.documentCount} 份补充资料 · {preparation.analyzed ? '已准备' : '待准备'}
          </small>
        </span>
        <time>{formatDate(preparation.updatedAt)}</time>
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
