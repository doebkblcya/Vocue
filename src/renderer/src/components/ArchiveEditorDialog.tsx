import { FileText, Trash2, Upload } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { InterviewStage } from '../../../shared/stage'
import type { LibraryDocumentSummary } from '../../../shared/types'
import { describeUsage } from '../document-usage'
import { getErrorMessage } from '../error-message'
import { ConfirmDialog } from './ConfirmDialog'
import { LibraryPickerDialog } from './LibraryPickerDialog'
import { StageStepper } from './StageStepper'

interface Draft {
  id?: string
  name: string
  jobDescription: string
  stage: InterviewStage
  resumeDocumentId: string | null
  documentIds: string[]
}

interface Props {
  preparationId: string | null
  onClose: () => void
  onSaved: () => Promise<void>
}

const EMPTY: Draft = {
  name: '',
  jobDescription: '',
  stage: null,
  resumeDocumentId: null,
  documentIds: [],
}

/**
 * 档案不再自己存正文：JD 仍然是档案独有的文本，
 * 简历和补充资料都只是对文档库的引用。
 */
export function ArchiveEditorDialog({
  preparationId,
  onClose,
  onSaved,
}: Props): React.JSX.Element {
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [library, setLibrary] = useState<LibraryDocumentSummary[]>([])
  const [loading, setLoading] = useState(Boolean(preparationId))
  /** 库列表没到手之前不渲染引用，避免把还没解析到的文档显示成「已删除」 */
  const [libraryReady, setLibraryReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [picker, setPicker] = useState<'resume' | 'documents' | null>(null)
  const [pendingJobImage, setPendingJobImage] = useState<File | null>(null)

  const refreshLibrary = async (): Promise<void> => {
    setLibrary(await window.vocue.library.list())
    setLibraryReady(true)
  }

  useEffect(() => {
    void refreshLibrary()
  }, [])

  useEffect(() => {
    if (!preparationId) return
    void window.vocue.preparations.get(preparationId).then((preparation) => {
      if (preparation) {
        setDraft({
          id: preparation.id,
          name: preparation.name,
          jobDescription: preparation.jobDescription,
          stage: preparation.stage,
          resumeDocumentId: preparation.resume?.id ?? null,
          documentIds: preparation.documents.map((document) => document.libraryDocumentId),
        })
      }
      setLoading(false)
    })
  }, [preparationId])

  const summaryOf = (id: string): LibraryDocumentSummary | undefined =>
    library.find((document) => document.id === id)

  /**
   * 直接在档案里上传简历：先按「简历」收进文档库，再挂到这份档案上。
   * 上传即入库，所以其他档案也能直接复用这一份。
   */
  const uploadResume = async (files: FileList | null): Promise<void> => {
    const file = files?.[0]
    if (!file) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const extracted = await window.vocue.documents.extract(
        file.name,
        new Uint8Array(await file.arrayBuffer()),
      )
      const saved = await window.vocue.library.add(extracted, 'resume')
      await refreshLibrary()
      setDraft((current) => ({ ...current, resumeDocumentId: saved.id }))
      setNotice(`「${saved.filename}」${describeUsage(saved.content.length).text}，已存入文档库 · 简历`)
    } catch (reason) {
      setError(getErrorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  /** 直接在档案里上传补充资料：同样先按「文档」入库，再挂到这份档案上 */
  const uploadMaterials = async (files: FileList | null): Promise<void> => {
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
      const addedIds: string[] = []
      const messages: string[] = []
      for (const document of extracted) {
        const saved = await window.vocue.library.add(document, 'document')
        addedIds.push(saved.id)
        messages.push(`「${saved.filename}」${describeUsage(saved.content.length).text}`)
      }
      await refreshLibrary()
      setDraft((current) => ({ ...current, documentIds: [...current.documentIds, ...addedIds] }))
      setNotice(`${messages.join('；')}，已存入文档库 · 文档`)
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

  const resume = draft.resumeDocumentId ? summaryOf(draft.resumeDocumentId) : undefined
  const resumeUsage = resume ? describeUsage(resume.totalChars) : null

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
          {loading || !libraryReady ? <div className="loading compact">正在读取档案…</div> : (
            <>
              <label>档案名称</label>
              <input
                value={draft.name}
                placeholder="例如：高级前端工程师"
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />

              <div className="archive-field">
                <div className="archive-field-head">
                  <label>面试阶段</label>
                </div>
                <StageStepper
                  stage={draft.stage}
                  onChange={(stage) => setDraft((current) => ({ ...current, stage }))}
                />
                <p className="archive-field-hint">
                  推进到下一轮就在这里加减；档案卡上点阶段也能直接推进一轮。
                </p>
              </div>

              <div className="archive-field">
                <div className="archive-field-head">
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

              <div className="archive-field">
                <div className="archive-field-head">
                  <label>我的简历</label>
                  <div className="archive-field-actions">
                    <label className="inline-upload">
                      <Upload size={13} />上传新简历
                      <input
                        type="file"
                        accept=".pdf,.md,.markdown,.txt"
                        onChange={(event) => {
                          void uploadResume(event.target.files)
                          event.currentTarget.value = ''
                        }}
                      />
                    </label>
                    <button
                      className="button secondary small"
                      disabled={busy}
                      onClick={() => setPicker('resume')}
                    >
                      从文档库选择
                    </button>
                  </div>
                </div>
                <div className={`archive-picked ${resume ? '' : 'empty'}`}>
                  <span className="library-row-icon"><FileText size={16} /></span>
                  <span className="archive-picked-copy">
                    {resume && resumeUsage ? (
                      <>
                        <strong>{resume.filename}</strong>
                        <small className={resumeUsage.truncated ? 'warn' : ''}>{resumeUsage.text}</small>
                      </>
                    ) : (
                      <>
                        <strong>未选择简历</strong>
                        <small>从文档库选一份，或直接上传新简历。</small>
                      </>
                    )}
                  </span>
                  {resume && (
                    <button
                      className="library-row-button"
                      title="取消选择"
                      onClick={() => setDraft((current) => ({ ...current, resumeDocumentId: null }))}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
                <p className="archive-field-hint">
                  上传的简历会自动收进「文档库 · 简历」；「从文档库选择」里只列简历。
                </p>
              </div>

              <div className="archive-field">
                <div className="archive-field-head">
                  <label>补充资料</label>
                  <div className="archive-field-actions">
                    <label className="inline-upload">
                      <Upload size={13} />上传新文档
                      <input
                        type="file"
                        multiple
                        accept=".pdf,.md,.markdown,.txt"
                        onChange={(event) => {
                          void uploadMaterials(event.target.files)
                          event.currentTarget.value = ''
                        }}
                      />
                    </label>
                    <button
                      className="button secondary small"
                      disabled={busy}
                      onClick={() => setPicker('documents')}
                    >
                      从文档库选择
                    </button>
                  </div>
                </div>
                <div className="document-chips">
                  {draft.documentIds.map((id) => {
                    const document = summaryOf(id)
                    const usage = document ? describeUsage(document.totalChars) : null
                    return (
                      <span key={id} className={usage?.truncated ? 'warn' : ''}>
                        <FileText size={14} />{document?.filename ?? '已删除的文档'}
                        <button
                          title="移除"
                          onClick={() => setDraft((current) => ({
                            ...current,
                            documentIds: current.documentIds.filter((item) => item !== id),
                          }))}
                        >×</button>
                      </span>
                    )
                  })}
                  {!draft.documentIds.length && <span className="empty-chip">没有补充资料</span>}
                </div>
                <p className="archive-field-hint">
                  上传的文档会自动收进「文档库 · 文档」；「从文档库选择」里只列文档。
                </p>
              </div>

              {notice && <div className="notice notice-success">{notice}</div>}
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
            <button className="button primary" disabled={busy || loading || !libraryReady} onClick={() => void save()}>
              {busy ? '处理中…' : '保存'}
            </button>
          </div>
        </footer>
      </section>

      {picker && (
        <LibraryPickerDialog
          title={picker === 'resume' ? '选择简历' : '选择补充资料'}
          category={picker === 'resume' ? 'resume' : 'document'}
          documents={library}
          selectedIds={picker === 'resume'
            ? (draft.resumeDocumentId ? [draft.resumeDocumentId] : [])
            : draft.documentIds}
          multiple={picker === 'documents'}
          onClose={() => setPicker(null)}
          onConfirm={(ids) => {
            if (picker === 'resume') {
              setDraft((current) => ({ ...current, resumeDocumentId: ids[0] ?? null }))
            } else {
              setDraft((current) => ({ ...current, documentIds: ids }))
            }
            setPicker(null)
          }}
        />
      )}

      {pendingJobImage && (
        <ConfirmDialog
          title="识别剪贴板图片？"
          description="将图片发送至 DeepSeek，提取岗位信息并添加到 JD。"
          confirmLabel="识别并添加"
          onCancel={() => setPendingJobImage(null)}
          onConfirm={() => {
            const image = pendingJobImage
            setPendingJobImage(null)
            void importJobImage(image)
          }}
        />
      )}
    </div>
  )
}
