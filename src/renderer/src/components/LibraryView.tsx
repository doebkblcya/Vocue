import { FileText, Pencil, Trash2, Upload, User } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { LibraryCategory, LibraryDocumentSummary } from '../../../shared/types'
import { MATERIAL_TEXT_LIMIT, formatCharCount } from '../../../shared/limits'
import { describeUsage } from '../document-usage'
import { getErrorMessage } from '../error-message'
import { PageHeader } from './PageHeader'

interface Props {
  /** 库变动后通知外层刷新档案列表（引用关系可能一起变了） */
  onChanged: () => Promise<void>
}

/**
 * 文档库分两类：简历是给档案当「我的简历」的，文档是补充资料。
 * 两个入口分开，省得把一份项目笔记误选成简历。
 */
export function LibraryView({ onChanged }: Props): React.JSX.Element {
  const [documents, setDocuments] = useState<LibraryDocumentSummary[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const resumeInput = useRef<HTMLInputElement>(null)
  const documentInput = useRef<HTMLInputElement>(null)

  const load = async (): Promise<void> => {
    setDocuments(await window.vocue.library.list())
  }

  useEffect(() => {
    void load()
  }, [])

  const upload = async (category: LibraryCategory, files: FileList | null): Promise<void> => {
    if (!files?.length) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const extracted = await Promise.all(
        Array.from(files).map(async (file) =>
          window.vocue.documents.extract(file.name, new Uint8Array(await file.arrayBuffer())),
        ),
      )
      for (const document of extracted) {
        await window.vocue.library.add(document, category)
      }
      await load()
      await onChanged()
      // 上传时就把「有没有被截断」说清楚，不能等用户自己发现
      setNotice(extracted.map(describeUpload).join('；'))
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  const commitRename = async (): Promise<void> => {
    const id = renamingId
    const filename = renameValue.trim()
    setRenamingId(null)
    if (!id || !filename) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await window.vocue.library.rename(id, filename)
      await load()
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (document: LibraryDocumentSummary): Promise<void> => {
    const label = document.category === 'resume' ? '简历' : '文档'
    if (!window.confirm(`从文档库删除${label}「${document.filename}」？引用它的档案会失去这份材料。`)) {
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await window.vocue.library.remove(document.id)
      await load()
      await onChanged()
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  const renderRows = (
    items: LibraryDocumentSummary[],
    emptyText: string,
  ): React.JSX.Element => {
    if (!items.length) return <p className="library-empty">{emptyText}</p>
    return (
      <div className="library-list">
        {items.map((document) => {
          const usage = describeUsage(document.totalChars)
          const renaming = renamingId === document.id
          return (
            <article key={document.id} className="library-row">
              <span className="library-row-icon"><FileText size={17} /></span>
              <span className="library-row-copy">
                {renaming ? (
                  <input
                    className="library-rename-input"
                    autoFocus
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void commitRename()
                      if (event.key === 'Escape') setRenamingId(null)
                    }}
                    onBlur={() => void commitRename()}
                  />
                ) : (
                  <strong title={document.filename}>{document.filename}</strong>
                )}
                <small className={usage.truncated ? 'warn' : ''}>{usage.text}</small>
              </span>
              <div className="library-row-actions">
                <button
                  className="library-row-button"
                  title="重命名"
                  disabled={busy || renaming}
                  onClick={() => {
                    setRenamingId(document.id)
                    setRenameValue(document.filename)
                  }}
                >
                  <Pencil size={15} />
                </button>
                <button
                  className="library-row-button"
                  title="从文档库删除"
                  disabled={busy}
                  onClick={() => void remove(document)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </article>
          )
        })}
      </div>
    )
  }

  const resumes = documents.filter((document) => document.category === 'resume')
  const materials = documents.filter((document) => document.category === 'document')

  return (
    <div className="page">
      <PageHeader
        eyebrow="LIBRARY"
        title="文档库"
        meta={(
          <span>全应用只存一份；单份最多 {formatCharCount(MATERIAL_TEXT_LIMIT)} 字进入提示词</span>
        )}
      />

      <div className="page-body">
        <input
          ref={resumeInput}
          type="file"
          multiple
          accept=".pdf,.md,.markdown,.txt"
          hidden
          onChange={(event) => {
            void upload('resume', event.target.files)
            event.currentTarget.value = ''
          }}
        />
        <input
          ref={documentInput}
          type="file"
          multiple
          accept=".pdf,.md,.markdown,.txt"
          hidden
          onChange={(event) => {
            void upload('document', event.target.files)
            event.currentTarget.value = ''
          }}
        />

        {notice && <div className="notice notice-success">{notice}</div>}
        {error && <div className="notice notice-error" role="alert">{error}</div>}

        <section className="library-section">
          <div className="library-section-head">
            <span className="library-section-icon accent"><User size={16} /></span>
            <span className="library-section-copy">
              <strong>简历</strong>
              <small>给档案当「我的简历」用，同一份可以被多个岗位复用。</small>
            </span>
            <span className="library-section-count">{resumes.length}</span>
            <button
              className="button primary small"
              disabled={busy}
              onClick={() => resumeInput.current?.click()}
            >
              <Upload size={14} />上传简历
            </button>
          </div>
          {renderRows(resumes, '还没有简历。上传一份，之后各档案直接引用。')}
        </section>

        <section className="library-section">
          <div className="library-section-head">
            <span className="library-section-icon"><FileText size={16} /></span>
            <span className="library-section-copy">
              <strong>文档</strong>
              <small>项目详述、笔记、术语表等，作为档案的补充资料。</small>
            </span>
            <span className="library-section-count">{materials.length}</span>
            <button
              className="button secondary small"
              disabled={busy}
              onClick={() => documentInput.current?.click()}
            >
              <Upload size={14} />上传文档
            </button>
          </div>
          {renderRows(materials, '还没有文档。上传项目详述或笔记，之后按需引用。')}
        </section>
      </div>
    </div>
  )
}

function describeUpload(document: { filename: string; content: string }): string {
  const usage = describeUsage(document.content.length)
  return usage.truncated
    ? `「${document.filename}」${usage.text}`
    : `「${document.filename}」${usage.text}，全部可用`
}
