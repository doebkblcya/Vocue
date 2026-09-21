import type { InterviewRecord } from '../../shared/types'
import { formatRecordingIssue } from '../../shared/recording-issue'
import {
  formatDuration,
  formatOffset,
  formatRecordStage,
  formatRecordStatus,
} from '../../shared/interview-record'
import { isUnrecognizedSpeech } from '../../shared/transcript'

const ROLE_TEXT = { interviewer: '面试官', candidate: '我' } as const

/** 和界面上的说法保持一致，读者在两边看到的是同一句话 */
const UNRECOGNIZED_PLACEHOLDER = '这一段没有识别到'

/**
 * 把一条面试记录原样序列化成 Markdown。
 *
 * **这里不做任何加工**：不合并连续同角色、不过滤语气词、不重排顺序、不改写文本。
 * 记录里存成什么样，导出就是什么样。要加工就应该在写记录那一刻做——放到导出
 * 来做，等于同一件事有了两个时机和两份结果，界面和文件迟早对不上。
 *
 * 唯一沿用的是界面读记录的同一套规则：用 cleanedText ?? text，并跳过被判为
 * 外放回声的段。那是用户显式做过的清理、已经存进库里的记录状态，不是导出时的加工。
 */
export function buildInterviewMarkdown(record: InterviewRecord): string {
  const lines = [
    `# ${record.preparationName}`,
    '',
    `- 开始时间：${formatAbsolute(record.startedAt)}`,
  ]
  // 轮次紧跟在开始时间后面：这两条一起回答「这是哪一场」。
  // 不知道轮次（通用面试、老记录）就整行不写，不用「未设置」凑数。
  const stage = formatRecordStage(record.stage)
  if (stage) lines.push(`- 轮次：${stage}`)
  lines.push(
    `- 时长：${formatDuration(record.durationMs)}`,
    `- 转写：${record.utteranceCount} 段`,
    `- 状态：${formatRecordStatus(record.status)}`,
  )

  if (record.status === 'incomplete') {
    lines.push(`- 记录不完整：${formatRecordingIssue(record.incompleteReason)}`)
  }
  if (record.echoCleanupApplied) {
    lines.push(
      `- 已清理外放回声：隐藏 ${record.echoRemovedCount} 段，整理 ${record.echoChangedCount} 段，原始记录仍然保留`,
    )
  }

  lines.push('', '---')

  for (const utterance of record.utterances) {
    if (utterance.excludedAsEcho) continue
    const text = (utterance.cleanedText ?? utterance.text).trim()
    lines.push(
      '',
      `**${formatOffset(utterance.startMs)} · ${ROLE_TEXT[utterance.role]}**`,
      isUnrecognizedSpeech(text) ? UNRECOGNIZED_PLACEHOLDER : text,
    )
  }

  lines.push('')
  return lines.join('\n')
}

/**
 * 导出文件名。
 *
 * 档案名是用户随手起的，可能带斜杠、冒号这些在文件系统里有含义的字符，
 * 统一洗成空格；再短也不会没有名字。
 */
export function buildExportFilename(record: InterviewRecord): string {
  const name = record.preparationName
    .replace(/[/\\:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
  return `${name || '面试记录'} ${formatDateStamp(record.startedAt)}.md`
}

/**
 * 导出的文件可能几年后才被打开，所以用完整的、无歧义的日期，
 * 而不是界面上那种省掉年份的「9月20日 10:59」。
 */
function formatAbsolute(iso: string): string {
  const date = new Date(iso)
  const pad = (value: number): string => String(value).padStart(2, '0')
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatDateStamp(iso: string): string {
  const date = new Date(iso)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
