import { formatCharCount, measureByLength } from '../../shared/limits'

export interface UsageLabel {
  text: string
  truncated: boolean
}

/**
 * 把「这份材料有多少字、会被用掉多少」翻译成给用户看的一句话。
 * 数字全部来自 shared/limits 里那唯一的上限，和实际发给模型的完全一致。
 */
export function describeUsage(totalChars: number): UsageLabel {
  const { total, used, truncated } = measureByLength(totalChars)
  if (!truncated) return { text: `已提取 ${formatCharCount(total)} 字`, truncated }
  return {
    text: `已提取 ${formatCharCount(total)} 字 · 超出上限的 ${formatCharCount(total - used)} 字不会进入提示词`,
    truncated,
  }
}
