import { describe, expect, it } from 'vitest'
import { joinPdfPage, type PdfTextPiece } from '../src/main/documents/extractor'

/** PDF 常把一个汉字切成一个 text item，这里照原样模拟。 */
const perChar = (text: string): PdfTextPiece[] =>
  [...text].map((str) => ({ str, hasEOL: false }))

const words = (...items: string[]): PdfTextPiece[] =>
  items.map((str) => ({ str, hasEOL: false }))

describe('PDF 文本拼接', () => {
  it('汉字被逐字切开时不插空格', () => {
    expect(joinPdfPage(perChar('教育背景'))).toBe('教育背景')
    expect(joinPdfPage(perChar('吉林财经大学'))).toBe('吉林财经大学')
  })

  it('英文单词被拆开时保留空格', () => {
    expect(joinPdfPage(words('Software', 'Engineer'))).toBe('Software Engineer')
  })

  it('中英混排只在该加的地方加空格', () => {
    const pieces = [...perChar('宋奇恒'), ...words('AI', 'Agent'), ...perChar('工程师')]
    expect(joinPdfPage(pieces)).toBe('宋奇恒AI Agent工程师')
  })

  it('用 hasEOL 还原换行', () => {
    expect(
      joinPdfPage([
        { str: '教育背景', hasEOL: true },
        { str: '吉林财经大学 计算机科学与技术', hasEOL: true },
        { str: '工作经历', hasEOL: false },
      ]),
    ).toBe('教育背景\n吉林财经大学 计算机科学与技术\n工作经历')
  })

  it('hasEOL 不可信时退回整页一行，而不是拆成单字行', () => {
    const pieces = [...'教育背景'].map((str) => ({ str, hasEOL: true }))
    expect(joinPdfPage(pieces)).toBe('教育背景')
  })

  it('把游离的空白 item 折叠成一个空格', () => {
    expect(
      joinPdfPage([
        { str: '上 海', hasEOL: false },
        { str: '   ·   ', hasEOL: false },
        { str: '13862893919', hasEOL: false },
      ]),
    ).toBe('上 海 · 13862893919')
  })

  it('全角标点与英文相邻时不乱加空格', () => {
    const pieces = [...words('LexisNexis'), { str: ' ', hasEOL: false }, ...perChar('（律商联讯）')]
    expect(joinPdfPage(pieces)).toBe('LexisNexis （律商联讯）')
  })
})
