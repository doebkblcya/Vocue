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
