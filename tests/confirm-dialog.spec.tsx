import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ConfirmDialog } from '../src/renderer/src/components/ConfirmDialog'

describe('应用内确认框', () => {
  it('确认按钮写明会发生什么，而不是只写「确定」', () => {
    const markup = renderToStaticMarkup(
      <ConfirmDialog
        title="推进面试阶段？"
        description={<><strong>一面</strong> 推进到 <strong>二面</strong></>}
        confirmLabel="推进到二面"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(markup).toContain('推进到二面')
    expect(markup).toContain('取消')
  })

  it('走的是应用内结构，不是 window.confirm', () => {
    const markup = renderToStaticMarkup(
      <ConfirmDialog
        title="推进面试阶段？"
        description="确认后进入下一轮"
        confirmLabel="推进到二面"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(markup).toContain('confirm-backdrop')
    expect(markup).toContain('confirm-card')
    expect(markup).toContain('role="alertdialog"')
  })
})
