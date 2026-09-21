import { formatStage } from './stage'
import type { InterviewStage } from './stage'
import type { InterviewRecordStatus } from './types'

/**
 * 面试记录的展示格式。
 *
 * 界面和 Markdown 导出必须共用同一套：否则你屏幕上看到的和导出去的就是两份
 * 东西，时间一长必然对不上。这些函数是纯的，所以放在 shared 里。
 */

const STATUS_TEXT: Record<InterviewRecordStatus, string> = {
  recording: '记录中',
  ready: '待复盘',
  reviewing: '复盘中',
  completed: '已复盘',
  incomplete: '记录不完整',
}

export function formatRecordStatus(status: InterviewRecordStatus): string {
  return STATUS_TEXT[status]
}

/**
 * 记录的面试轮次标签；不知道轮次时返回 null。
 *
 * 「不知道」有两种来源，处理方式必须一致：通用面试没有档案，以及这一列
 * 出现之前建的老记录。两者都不去档案里现查当前轮次——档案会被推进到
 * 下一面，查出来的值会把历史记录追溯改写成新一轮。
 *
 * 返回 null 而不是「未设置」：记录列表很窄，把「不知道」摆出来只是噪音。
 * 界面和导出共用这一个判断，所以两边不会一个显示、一个不显示。
 */
export function formatRecordStage(stage: InterviewStage): string | null {
  return stage === null ? null : formatStage(stage)
}

/** 时长：不满一分钟只给秒，避免出现「0 分 42 秒」这种 */
export function formatDuration(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60_000)
  const seconds = Math.floor(milliseconds / 1000) % 60
  return minutes ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`
}

/**
 * 相对面试开始的偏移，mm:ss。
 *
 * 超过一小时的面试会自然进位成 65:30，不拆成 1:05:30：
 * 一场面试里「第 65 分钟」比「1 小时 5 分」更容易定位。
 */
export function formatOffset(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0')
  return `${minutes}:${(seconds % 60).toString().padStart(2, '0')}`
}
