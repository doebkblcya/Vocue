import { describe, expect, it } from 'vitest'
import { formatRecordingIssue, type RecordingIssue } from '../src/shared/recording-issue'

const ALL_ISSUES: RecordingIssue[] = [
  'app_terminated',
  'candidate_backlog',
  'microphone_unavailable',
  'asr_reconnecting',
  'candidate_asr_error',
  'system_audio_failed',
  'transcript_finalize_failed',
]

describe('记录不完整的原因', () => {
  it('每个原因都有可读文案，不能把原始 code 丢给用户', () => {
    for (const issue of ALL_ISSUES) {
      const text = formatRecordingIssue(issue)
      expect(text).not.toBe('')
      expect(text).not.toBe(issue)
    }
  })

  it('老记录没有原因时给笼统说法，不编一个具体的', () => {
    expect(formatRecordingIssue(null)).toBe('转写过程发生过中断')
  })
})
