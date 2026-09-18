import { FileText, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { LibraryDocumentSummary } from '../../../shared/types'
import { MATERIAL_TEXT_LIMIT, formatCharCount } from '../../../shared/limits'
import { describeUsage } from '../document-usage'
import { getErrorMessage } from '../error-message'
import { PageHeader } from './PageHeader'

interface Props {
  /** 库变动后通知外层刷新档案列表（引用关系可能一起变了） */
  onChanged: () => Promise<void>
}

export function LibraryView({ onChanged }: Props): React.JSX.Element {
  const [documents, setDocuments] = useState<LibraryDocumentSummary[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  const load = async (): Promise<void> => {
    setDocuments(await window.vocue.library.list())
  }

  useEffect(() => {
    void load()
  }, [])

  const upload = async (files: FileList | null): Promise<void> => {
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
        await window.vocue.library.add(document)
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

  const remove = async (document: LibraryDocumentSummary): Promise<void> => {
    if (!window.confirm(`从文档库删除「${document.filename}」？引用它的档案会失去这份材料。`)) return
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

  return (
    <div className="page">
      <PageHeader
        eyebrow="LIBRARY"
        title="文档库"
        meta={(
          <span>全应用只存一份；单份最多 {formatCharCount(MATERIAL_TEXT_LIMIT)} 字进入提示词</span>
        )}
        action={(
          <button className="button primary small" disabled={busy} onClick={() => fileInput.current?.click()}>
            <Upload size={15} />上传文档
          </button>
        )}
      />

      <div className="page-body">
        <input
          ref={fileInput}
          type="file"
          multiple
          accept=".pdf,.md,.markdown,.txt"
          hidden
          onChange={(event) => {
            void upload(event.target.files)
            event.currentTarget.value = ''
          }}
        />

        {notice && <div className="notice notice-success">{notice}</div>}
        {error && <div className="notice notice-error" role="alert">{error}</div>}

        {documents.length ? (
          <div className="library-list">
            {documents.map((document) => {
              const usage = describeUsage(document.totalChars)
              return (
                <article key={document.id} className="library-row">
                  <span className="library-row-icon"><FileText size={17} /></span>
                  <span className="library-row-copy">
                    <strong>{document.filename}</strong>
                    <small className={usage.truncated ? 'warn' : ''}>{usage.text}</small>
                  </span>
                  <button
                    className="library-row-remove"
                    title="从文档库删除"
                    disabled={busy}
                    onClick={() => void remove(document)}
                  >
                    <Trash2 size={15} />
                  </button>
                </article>
              )
            })}
          </div>
        ) : (
          <button className="archive-empty" disabled={busy} onClick={() => fileInput.current?.click()}>
            <span className="archive-card-icon"><Upload size={20} /></span>
            <span>
              <strong>上传第一份文档</strong>
              <small>简历、项目详述、笔记都可以放这里，之后在各档案里按需引用。</small>
            </span>
          </button>
        )}
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
