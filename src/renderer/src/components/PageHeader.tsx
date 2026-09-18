import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'

interface Props {
  /** 英文小标，例如 WORKSPACE、ARCHIVES、INTERVIEW RECORD */
  eyebrow: string
  title: string
  /** 标题下的补充信息，通常是时间、时长、段数这类只读数据 */
  meta?: ReactNode
  /** 页面主操作。同一屏最多一个 primary */
  action?: ReactNode
  onBack?: () => void
  backTitle?: string
}

/** 所有内容页共用的标题行，保证三个页面的层级和间距完全一致。 */
export function PageHeader({
  eyebrow,
  title,
  meta,
  action,
  onBack,
  backTitle = '返回',
}: Props): React.JSX.Element {
  return (
    <header className="page-header">
      <div className="page-heading">
        {onBack && (
          <button className="page-back" title={backTitle} onClick={onBack}>
            <ArrowLeft size={17} />
          </button>
        )}
        <div className="page-heading-copy">
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          {meta && <div className="page-meta">{meta}</div>}
        </div>
      </div>
      {action && <div className="page-actions">{action}</div>}
    </header>
  )
}
