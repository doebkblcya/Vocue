import { FileText, Trash2, Upload } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ExtractedDocument, Preparation } from '../../../shared/types'
import { getErrorMessage } from '../error-message'

interface Draft {
  id?: string
  name: string
  jobDescription: string
  resume: string
  documents: ExtractedDocument[]
}

interface Props {
  preparationId: string | null
  onClose: () => void
  onSaved: () => Promise<void>
}

const EMPTY: Draft = { name: '', jobDescription: '', resume: '', documents: [] }

const toDraft = (preparation: Preparation): Draft => ({
  id: preparation.id,
  name: preparation.name,
  jobDescription: preparation.jobDescription,
  resume: preparation.resume,
  documents: preparation.documents.map(({ filename, kind, content }) => ({ filename, kind, content })),
})

export function ArchiveEditorDialog({
  preparationId,
  onClose,
  onSaved,
}: Props): React.JSX.Element {
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [loading, setLoading] = useState(Boolean(preparationId))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pendingJobImage, setPendingJobImage] = useState<File | null>(null)

  useEffect(() => {
    if (!preparationId) return
    void window.vocue.preparations.get(preparationId).then((preparation) => {
      if (preparation) setDraft(toDraft(preparation))
      setLoading(false)
    })
  }, [preparationId])

  const addFiles = async (files: FileList | null): Promise<void> => {
    if (!files?.length) return
    if (draft.documents.length + files.length > 5) {
      setError('补充资料最多 5 个文件')
      return
    }
    setBusy(true)
    setError('')
    try {
      const documents = await Promise.all(
        Array.from(files).map(async (file) =>
          window.vocue.documents.extract(file.name, new Uint8Array(await file.arrayBuffer())),
        ),
      )
      setDraft((current) => ({ ...current, documents: [...current.documents, ...documents] }))
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  const importResume = async (file: File | undefined): Promise<void> => {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const document = await window.vocue.documents.extract(
        file.name,
        new Uint8Array(await file.arrayBuffer()),
      )
      setDraft((current) => ({ ...current, resume: document.content }))
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  const importJobImage = async (file: File | undefined): Promise<void> => {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const extensionByType: Record<string, string> = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
      }
      const filename = extensionByType[file.type]
        ? `job-description.${extensionByType[file.type]}`
        : file.name
      const content = await window.vocue.documents.recognizeImage(
        filename,
        new Uint8Array(await file.arrayBuffer()),
      )
      setDraft((current) => ({
        ...current,
        jobDescription: current.jobDescription.trim()
          ? `${current.jobDescription.trim()}\n\n${content}`
          : content,
      }))
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await window.vocue.preparations.save(draft)
      await onSaved()
      onClose()
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!preparationId || !window.confirm('确定删除这份面试档案吗？')) return
    setBusy(true)
    setError('')
    try {
      await window.vocue.preparations.remove(preparationId)
      await onSaved()
      onClose()
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="archive-title">
      <section className="dialog-card archive-dialog">
        <header className="dialog-header">
          <div>
            <p className="eyebrow">INTERVIEW ARCHIVE</p>
            <h2 id="archive-title">{preparationId ? '编辑面试档案' : '新建面试档案'}</h2>
          </div>
        </header>

        <div className="dialog-content archive-form">
          {loading ? <div className="loading compact">正在读取档案…</div> : (
            <>
              <label>档案名称</label>
              <input
                value={draft.name}
                placeholder="例如：高级前端工程师 · 第三轮"
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />

              <div className="archive-columns">
                <div>
                  <div className="archive-field-header">
                    <label>岗位 JD</label>
                    <label className="inline-upload">
                      <Upload size={13} />上传图片
                      <input
                        type="file"
                        accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                        onChange={(event) => {
                          void importJobImage(event.target.files?.[0])
                          event.currentTarget.value = ''
                        }}
                      />
                    </label>
                  </div>
                  <textarea
                    value={draft.jobDescription}
                    placeholder="粘贴岗位描述文字或截图，也可以上传图片…"
                    onChange={(event) => setDraft({ ...draft, jobDescription: event.target.value })}
                    onPaste={(event) => {
                      const image = Array.from(event.clipboardData.items)
                        .find((item) => item.type.startsWith('image/'))
                        ?.getAsFile()
                      if (!image) return
                      event.preventDefault()
                      setPendingJobImage(image)
                    }}
                  />
                </div>
                <div>
                  <div className="archive-field-header">
                    <label>我的简历</label>
                    <label className="inline-upload">
                      <Upload size={13} />上传简历
                      <input
                        type="file"
                        accept=".pdf,.md,.markdown,.txt"
                        onChange={(event) => {
                          void importResume(event.target.files?.[0])
                          event.currentTarget.value = ''
                        }}
                      />
                    </label>
                  </div>
                  <textarea
                    value={draft.resume}
                    placeholder="粘贴简历正文，或上传 PDF、Markdown、TXT…"
                    onChange={(event) => setDraft({ ...draft, resume: event.target.value })}
                  />
                </div>
              </div>

              <div className="archive-documents-heading">
                <div><strong>补充资料</strong><small>最多 5 个；支持 PDF、Markdown、TXT</small></div>
                <label className="upload-button">
                  <Upload size={15} />添加文件
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.md,.markdown,.txt"
                    onChange={(event) => void addFiles(event.target.files)}
                  />
                </label>
              </div>
              <div className="document-chips">
                {draft.documents.map((document, index) => (
                  <span key={`${document.filename}-${index}`}>
                    <FileText size={14} />{document.filename}
                    <button
                      title="移除"
                      onClick={() => setDraft((current) => ({
                        ...current,
                        documents: current.documents.filter((_, itemIndex) => itemIndex !== index),
                      }))}
                    >×</button>
                  </span>
                ))}
                {!draft.documents.length && <span className="empty-chip">没有补充资料</span>}
              </div>
              {error && <div className="notice notice-error" role="alert">{error}</div>}
            </>
          )}
        </div>

        <footer className="dialog-actions split">
          <div>
            {preparationId && (
              <button className="button ghost danger-text" disabled={busy} onClick={() => void remove()}>
                <Trash2 size={15} />删除档案
              </button>
            )}
          </div>
          <div>
            <button className="button ghost" disabled={busy} onClick={onClose}>取消</button>
            <button className="button primary" disabled={busy || loading} onClick={() => void save()}>
              {busy ? '处理中…' : '保存'}
            </button>
          </div>
        </footer>
      </section>

      {pendingJobImage && (
        <div className="paste-confirm-backdrop">
          <section
            className="paste-confirm-card"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="paste-confirm-title"
          >
            <h3 id="paste-confirm-title">识别剪贴板图片？</h3>
            <p>将图片发送至 DeepSeek，提取岗位信息并添加到 JD。</p>
            <div>
              <button className="button ghost" onClick={() => setPendingJobImage(null)}>取消</button>
              <button
                className="button primary"
                onClick={() => {
                  const image = pendingJobImage
                  setPendingJobImage(null)
                  void importJobImage(image)
                }}
              >
                识别并添加
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
