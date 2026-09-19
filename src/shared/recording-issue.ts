/**
 * 记录为什么被判为不完整。
 *
 * 只留第一个触发点：后面的通常都是它的连锁反应
 * （候选人音频一积压，紧接着必然是一次重连），根因比罗列清单有用。
 */
export type RecordingIssue =
  | 'app_terminated'
  | 'candidate_backlog'
  | 'microphone_unavailable'
  | 'asr_reconnecting'
  | 'candidate_asr_error'
  | 'system_audio_failed'
  | 'transcript_finalize_failed'

const ISSUE_TEXT: Record<RecordingIssue, string> = {
  app_terminated: '上次面试没有正常结束，应用被关闭或中断了',
  candidate_backlog: '语音识别一直连不上，候选人有一段音频没送出去',
  microphone_unavailable: '麦克风转写不可用',
  asr_reconnecting: '语音识别服务断线，中途重连过',
  candidate_asr_error: '候选人语音转写出错',
  system_audio_failed: '系统音频捕获失败',
  transcript_finalize_failed: '结束时最后一段语音没来得及识别完',
}

/** 老记录没有存原因，只能给出笼统说法，不能编一个具体的 */
export function formatRecordingIssue(issue: RecordingIssue | null): string {
  return issue ? ISSUE_TEXT[issue] : '转写过程发生过中断'
}
