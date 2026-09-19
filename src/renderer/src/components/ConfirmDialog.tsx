import { useEffect, type ReactNode } from 'react'

interface Props {
  title: string
  description: ReactNode
  /** 确认按钮的文案写成会发生什么，例如「推进到二面」，而不是「确定」 */
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}

/**
 * 应用内的小确认框。
 *
 * 不用 window.confirm：原生弹窗读不到应用的主题、字体和圆角，
 * 深浅色下都和界面脱节。这里和其余弹窗共用同一套 token。
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
}: Props): React.JSX.Element {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  return (
    <div
      className="confirm-backdrop"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <section className="confirm-card">
        <h3 id="confirm-title">{title}</h3>
        <p>{description}</p>
        <div>
          <button className="button ghost" onClick={onCancel}>取消</button>
          <button className="button primary" autoFocus onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </section>
    </div>
  )
}
