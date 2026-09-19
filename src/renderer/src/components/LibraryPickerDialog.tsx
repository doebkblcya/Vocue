import { useState } from 'react'
import { FileText } from 'lucide-react'
import type { LibraryCategory, LibraryDocumentSummary } from '../../../shared/types'
import { describeUsage } from '../document-usage'

interface Props {
  title: string
  /** 只挑这一类：选简历时不把补充资料混进来 */
  category: LibraryCategory
  documents: LibraryDocumentSummary[]
  selectedIds: string[]
  /** 简历只允许选一份，补充资料可以多选 */
  multiple: boolean
  onClose: () => void
  onConfirm: (ids: string[]) => void
}

export function LibraryPickerDialog({
  title,
  category,
  documents,
  selectedIds,
  multiple,
  onClose,
  onConfirm,
}: Props): React.JSX.Element {
  const [selected, setSelected] = useState<string[]>(selectedIds)

  // 已经挂上的照旧显示，哪怕分类对不上：确认时悄悄丢掉它比多显示一行更糟
  const items = documents.filter(
    (document) => document.category === category || selectedIds.includes(document.id),
  )

  const toggle = (id: string): void => {
    setSelected((current) => {
      if (!multiple) return current.includes(id) ? [] : [id]
      return current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    })
  }

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <section className="dialog-card picker-dialog">
        <header className="dialog-header">
          <div>
            <p className="eyebrow">DOCUMENT LIBRARY</p>
            <h2>{title}</h2>
          </div>
        </header>

        <div className="dialog-content">
          {items.length ? (
            <div className="picker-list">
              {items.map((document) => {
                const usage = describeUsage(document.totalChars)
                return (
                  <button
                    key={document.id}
                    type="button"
                    className={`picker-row ${selected.includes(document.id) ? 'selected' : ''}`}
                    aria-pressed={selected.includes(document.id)}
                    onClick={() => toggle(document.id)}
                  >
                    <span className="picker-check" aria-hidden="true" />
                    <span className="picker-copy">
                      <strong>{document.filename}</strong>
                      <small className={usage.truncated ? 'warn' : ''}>{usage.text}</small>
                    </span>
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="picker-empty">
              <FileText size={22} />
              {category === 'resume'
                ? '文档库里还没有简历。先到「文档库 · 简历」上传一份。'
                : '文档库里还没有文档。先到「文档库 · 文档」上传，或直接在档案里上传新文件。'}
            </p>
          )}
        </div>

        <footer className="dialog-actions">
          <button className="button ghost" onClick={onClose}>取消</button>
          <button className="button primary" onClick={() => onConfirm(selected)}>确定</button>
        </footer>
      </section>
    </div>
  )
}
