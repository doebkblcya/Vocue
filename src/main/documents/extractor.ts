import { extname } from 'node:path'
import type { ExtractedDocument, PreparationDocument } from '../../shared/types'

const MAX_BYTES = 5 * 1024 * 1024

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
      const line = text.items
        .map((item) => ('str' in item ? item.str : ''))
        .filter(Boolean)
        .join(' ')
      pages.push(line)
    }
  } finally {
    await loadingTask.destroy()
  }
  return pages.join('\n\n')
}
