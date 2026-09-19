/**
 * 单份材料进入提示词时最多使用的字符数。
 *
 * 这是唯一的出处：主进程裁剪和界面提示都读它，不存在第二个魔数。
 * 它的作用是拦住病态上传（比如误传一整本书），不是日常约束 ——
 * 一份简历一两千字，项目笔记也就几千字，正常根本碰不到。
 *
 * 超过的部分**不会被删除**：文档库里始终存全文，这里只是取用规则。
 * 所以调整这个数字不需要重新上传任何文档。
 */
export const MATERIAL_TEXT_LIMIT = 100_000

/**
 * 一个档案的资料合计超过这个字数，就在界面上提醒一句。
 *
 * **这不是上限。** 超了照样全文发给模型——上下文有 1M token，装得下。
 * 它只是一句提醒：资料越多，第一道题等得越久，回答也可能不够聚焦。
 *
 * 和 MATERIAL_TEXT_LIMIT 拦的不是一回事：那个拦「误传一整本书」，
 * 这个拦「一份一份攒成了一本书」。正常用量（JD + 简历 + 几份笔记）在 3 万字上下。
 */
export const ARCHIVE_MATERIAL_WARN_LIMIT = 100_000

export interface MaterialUsage {
  /** 全文长度 */
  total: number
  /** 实际会进入提示词的长度 */
  used: number
  truncated: boolean
}

export function measureByLength(totalChars: number): MaterialUsage {
  const used = Math.min(totalChars, MATERIAL_TEXT_LIMIT)
  return { total: totalChars, used, truncated: totalChars > used }
}

export function measureMaterial(content: string): MaterialUsage {
  return measureByLength(content.length)
}

/**
 * 真正发给模型的那一段。
 * 末尾标注让模型知道「这里被切了」，避免它把截断当成内容结束。
 */
export function usableMaterial(content: string): string {
  return measureMaterial(content).truncated
    ? `${content.slice(0, MATERIAL_TEXT_LIMIT)}\n[内容已截断]`
    : content
}

export function formatCharCount(value: number): string {
  return value.toLocaleString('zh-CN')
}
