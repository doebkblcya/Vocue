import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LibraryPickerDialog } from '../src/renderer/src/components/LibraryPickerDialog'
import type { LibraryDocumentSummary } from '../src/shared/types'

const documents: LibraryDocumentSummary[] = [
  { id: 'r1', filename: 'main.pdf', kind: 'pdf', category: 'resume', updatedAt: '', totalChars: 3554 },
  { id: 'd1', filename: '术语表.md', kind: 'markdown', category: 'document', updatedAt: '', totalChars: 29284 },
]

function render(category: 'resume' | 'document', selectedIds: string[] = []): string {
  return renderToStaticMarkup(
    <LibraryPickerDialog
      title="选择"
      category={category}
      documents={documents}
      selectedIds={selectedIds}
      multiple={category === 'document'}
      onClose={() => {}}
      onConfirm={() => {}}
    />,
  )
}

describe('文档库选择器按分类过滤', () => {
  it('选简历时不混入补充资料，反之亦然', () => {
    expect(render('resume')).toContain('main.pdf')
    expect(render('resume')).not.toContain('术语表.md')
    expect(render('document')).toContain('术语表.md')
    expect(render('document')).not.toContain('main.pdf')
  })

  it('已经挂上的文档即使分类对不上也照旧显示，避免确认时被悄悄丢掉', () => {
    const markup = render('document', ['r1'])
    expect(markup).toContain('main.pdf')
    expect(markup).toContain('术语表.md')
  })

  it('空列表给出对应分类的引导文案', () => {
    const empty = renderToStaticMarkup(
      <LibraryPickerDialog
        title="选择简历"
        category="resume"
        documents={[]}
        selectedIds={[]}
        multiple={false}
        onClose={() => {}}
        onConfirm={() => {}}
      />,
    )
    expect(empty).toContain('还没有简历')
  })
})
