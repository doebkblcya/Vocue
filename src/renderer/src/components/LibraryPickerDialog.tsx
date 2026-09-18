import { useState } from 'react'
import { FileText } from 'lucide-react'
import type { LibraryDocumentSummary } from '../../../shared/types'
import { describeUsage } from '../document-usage'

interface Props {
  title: string
  documents: LibraryDocumentSummary[]
  selectedIds: string[]
  /** 简历只允许选一份，补充资料可以多选 */
  multiple: boolean
  onClose: () => void
  onConfirm: (ids: string[]) => void
}

export function LibraryPickerDialog({
  title,
  documents,
  selectedIds,
  multiple,
  onClose,
  onConfirm,
}: Props): React.JSX.Element {
  const [selected, setSelected] = useState<string[]>(selectedIds)

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
          {documents.length ? (
            <div className="picker-list">
              {documents.map((document) => {
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
              文档库还是空的。先到「文档库」上传，或直接在档案里上传新文件。
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
