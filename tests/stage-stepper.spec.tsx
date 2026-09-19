import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StageStepper } from '../src/renderer/src/components/StageStepper'

function render(stage: number | null): string {
  return renderToStaticMarkup(<StageStepper stage={stage} onChange={() => {}} />)
}

describe('面试阶段步进器', () => {
  it('不铺选项列表：轮次再多也只显示当前那一面', () => {
    const markup = render(20)
    expect(markup).toContain('20 面')
    // 列 20 个选项的话这里必然出现相邻轮次
    expect(markup).not.toContain('19 面')
    expect(markup).not.toContain('十面')
  })

  it('未设置时退无可退，也不显示清除', () => {
    const markup = render(null)
    expect(markup).toContain('未设置')
    expect(markup).toContain('disabled')
    expect(markup).not.toContain('清除')
  })

  it('按钮提示写明点下去会到哪一面', () => {
    expect(render(null)).toContain('进入AI 面')
    expect(render(1)).toContain('进入二面')
    expect(render(1)).toContain('清除')
  })
})
