import { extname } from 'node:path'
import type { ExtractedDocument, PreparationDocument } from '../../shared/types'

const MAX_BYTES = 5 * 1024 * 1024

/**
 * 中日韩文字与全角标点。
 *
 * PDF 常把每个汉字拆成独立的 text item，早先按 `join(' ')` 硬拼，
 * 抽出来的简历是「教 育 背 景 吉 林财 经大学」——既丢结构，
 * 又凭空多出四成空白字符，把字数上限和提示词一起撑大。
 */
const CJK = /[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF]/

function normalizeLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim()
}

function needsSpace(previous: string, next: string): boolean {
  const before = previous.at(-1) ?? ''
  const after = next[0] ?? ''
  if (!before || !after) return false
  // 任一侧本来就是空白，交给后续的空白规整，不要重复插
  if (/\s/.test(before) || /\s/.test(after)) return false
  // 汉字之间不插空格，英文单词之间才需要
  return !CJK.test(before) && !CJK.test(after)
}

function appendPiece(current: string, next: string): string {
  if (!next) return current
  return current && needsSpace(current, next) ? `${current} ${next}` : current + next
}

export interface PdfTextPiece {
  str: string
  hasEOL: boolean
}

/** 把一个 PDF 页面的 text item 还原成带换行的文本。 */
export function joinPdfPage(pieces: PdfTextPiece[]): string {
  const lines: string[] = []
  let line = ''
  for (const piece of pieces) {
    line = appendPiece(line, piece.str)
    if (piece.hasEOL) {
      lines.push(normalizeLine(line))
      line = ''
    }
  }
  lines.push(normalizeLine(line))
  const kept = lines.filter(Boolean)

  // 少数 PDF 给每个字符都标了 hasEOL，那样会把整页拆成单字行。
  // 行均非空白字符数过小时判定该标记不可信，退回「整页一行」。
  const nonSpace = kept.reduce((total, item) => total + item.replace(/\s/g, '').length, 0)
  if (kept.length > 1 && nonSpace / kept.length < 2) {
    return normalizeLine(pieces.reduce((text, piece) => appendPiece(text, piece.str), ''))
  }
  return kept.join('\n')
}

export async function extractDocument(
  filename: string,
  bytes: Uint8Array,
): Promise<ExtractedDocument> {
  if (bytes.byteLength > MAX_BYTES) throw new Error('单个文件不能超过 5 MB')

  const extension = extname(filename).toLowerCase()
  let content: string
  let kind: PreparationDocument['kind']

  if (extension === '.pdf') {
    kind = 'pdf'
    content = await extractPdfText(bytes)
  } else if (extension === '.md' || extension === '.markdown') {
    kind = 'markdown'
    content = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  } else if (extension === '.txt') {
    kind = 'text'
    content = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  } else {
    throw new Error('仅支持 PDF、Markdown 和 TXT 文件')
  }

  content = content.replace(/\u0000/g, '').trim()
  if (!content) {
    const hint = kind === 'pdf'
      ? '这份 PDF 没有可提取的文字，请上传带文字层的 PDF'
      : '文件内容为空'
    throw new Error(hint)
  }
  // 这里不做任何截断：库里的文档始终是完整的。
  // 超出上限的部分只是不进入提示词，由界面明确告知用户。
  return { filename, kind, content }
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loadingTask = pdfjs.getDocument({ data: bytes.slice() })
  const pdf = await loadingTask.promise
  const pages: string[] = []
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const text = await page.getTextContent()
      const pieces: PdfTextPiece[] = []
      for (const item of text.items) {
        if ('str' in item && item.str) pieces.push({ str: item.str, hasEOL: item.hasEOL })
      }
      const pageText = joinPdfPage(pieces)
      if (pageText) pages.push(pageText)
    }
  } finally {
    await loadingTask.destroy()
  }
  return pages.join('\n\n')
}
