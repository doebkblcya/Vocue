import type { InterviewRecord, Preparation } from '../../shared/types'
import { usableMaterial } from '../../shared/limits'
import { formatRecordingIssue } from '../../shared/recording-issue'

export function buildInterviewReviewPrompt(
  record: InterviewRecord,
  preparation: Preparation | null,
): string {
  const transcript = record.utterances
    .filter((utterance) => !utterance.excludedAsEcho)
    .map((utterance) => {
      const role = utterance.role === 'interviewer' ? '面试官' : '候选人'
      return `[${formatTime(utterance.startMs)}] ${role}：${utterance.cleanedText ?? utterance.text}`
    })
    .join('\n')

  return [
    '请根据完整面试转写，为候选人生成一份简洁、诚实、可执行的中文复盘。',
    '转写可能有少量识别错误；只依据明确内容判断，不要杜撰没有发生的问答。',
    '使用 Markdown，严格按以下结构输出：',
    '# 面试复盘',
    '## 总评（给出 0-100 分和两三句结论）',
    '## 做得好的地方（最多 4 条，每条引用具体表现）',
    '## 需要改进（最多 4 条，每条给出可执行建议）',
    '## 关键问题回看（最多 5 个问题，简述回答质量与更好的答法）',
    '## 下一步准备（最多 5 条）',
    preparation
      ? [
          `岗位档案：${preparation.name}`,
          `岗位描述：${usableMaterial(preparation.jobDescription)}`,
          preparation.resume
            ? `候选人简历：${usableMaterial(preparation.resume.content)}`
            : '候选人简历：未提供',
        ].join('\n')
      : '岗位档案：通用面试（没有额外 JD 或简历）',
    record.status === 'incomplete'
      ? `记录完整性：${formatRecordingIssue(record.incompleteReason)}，结论中请明确提醒用户复核缺失处。`
      : '记录完整性：正常结束。',
    `面试转写：\n${transcript}`,
  ].join('\n\n')
}

function formatTime(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}
