import { describe, expect, it } from 'vitest'
import { joinPdfPage, type PdfTextPiece } from '../src/main/documents/extractor'

const perChar = (text: string): PdfTextPiece[] =>
  [...text].map((str) => ({ str, hasEOL: false }))

const words = (...items: string[]): PdfTextPiece[] =>
  items.map((str) => ({ str, hasEOL: false }))

/**
 * 拼接规则靠正则判断要不要插空格，读代码看不出结果对不对。
 * 背景：PDF 常把一个汉字切成一个 text item，早先一律用空格拼，
 * 抽出「教 育 背 景」，凭空多出四成空白字符。
 */
describe('PDF 文本拼接', () => {
  it('汉字逐字切开时不插空格，中英混排也不乱插', () => {
    expect(joinPdfPage(perChar('教育背景'))).toBe('教育背景')
    expect(joinPdfPage([
      ...perChar('宋奇恒'),
      ...words('AI', 'Agent'),
      ...perChar('工程师'),
    ])).toBe('宋奇恒AI Agent工程师')
  })

  it('hasEOL 不可信（每个字都标换行）时退回整页一行，而不是拆成单字行', () => {
    const pieces = [...'教育背景'].map((str) => ({ str, hasEOL: true }))
    expect(joinPdfPage(pieces)).toBe('教育背景')
  })
})
