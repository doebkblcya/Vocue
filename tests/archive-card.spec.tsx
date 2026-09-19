import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ArchiveCard } from '../src/renderer/src/components/ArchiveCard'
import type { PreparationSummary } from '../src/shared/types'

function render(stage: number | null): string {
  const preparation: PreparationSummary = {
    id: 'p1',
    name: '孚厘科技 外包',
    stage,
    updatedAt: '2026-01-01T00:00:00.000Z',
    documentCount: 2,
    hasResume: true,
  }
  return renderToStaticMarkup(
    <ArchiveCard
      preparation={preparation}
      onEdit={() => {}}
      onStart={() => {}}
      onAdvanceStage={() => {}}
    />,
  )
}

describe('档案卡上的面试阶段', () => {
  it('显示当前阶段，并写明点一下会到哪一面', () => {
    expect(render(1)).toContain('一面')
    expect(render(1)).toContain('点击进入二面')
    expect(render(0)).toContain('AI 面')
    expect(render(0)).toContain('点击进入一面')
  })

  it('未设置时也能一键起步', () => {
    const markup = render(null)
    expect(markup).toContain('未设置')
    expect(markup).toContain('点击进入AI 面')
  })
})
