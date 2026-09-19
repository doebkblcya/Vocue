/**
 * 面试阶段用序数表示，不用字符串枚举：
 * 0 = AI 面，n ≥ 1 = n 面，null = 还没定。
 * 面试轮次没有上限（有公司能面到七八轮），所以既不能写成固定枚举，
 * 也不能用「把所有选项列出来」的控件——界面只做加减，不铺列表。
 */
export type InterviewStage = number | null

const CHINESE_NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']

export function formatStage(stage: InterviewStage): string {
  if (stage === null) return '未设置'
  if (stage === 0) return 'AI 面'
  return stage <= CHINESE_NUMERALS.length ? `${CHINESE_NUMERALS[stage - 1]}面` : `${stage} 面`
}

/** 推进一轮：未设置 → AI 面 → 一面 → 二面 … */
export function nextStage(stage: InterviewStage): number {
  return stage === null ? 0 : stage + 1
}

/** 退回一轮：二面 → 一面 → AI 面 → 未设置；已经是未设置就停在未设置 */
export function previousStage(stage: InterviewStage): InterviewStage {
  if (stage === null || stage === 0) return null
  return stage - 1
}
