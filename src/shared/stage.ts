/**
 * 面试阶段用序数表示，不用字符串枚举：
 * 0 = AI 面，n ≥ 1 = n 面，null = 还没定。
 * 面试轮次没有上限（有公司能面到七八轮），所以不能写成固定枚举。
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

/** 编辑档案时列出的全部阶段：未设置 + AI 面 + 一至十面 */
export const STAGE_CHOICES: number[] = Array.from({ length: 11 }, (_, index) => index)
