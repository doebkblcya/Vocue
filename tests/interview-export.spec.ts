import { describe, expect, it } from 'vitest'
import { buildExportFilename, buildInterviewMarkdown } from '../src/main/session/interview-export'
import type { InterviewRecord, InterviewUtterance } from '../src/shared/types'

/**
 * 导出格式是跟用户文件之间的契约：他会把它粘进 Notion、发给别人、几年后再打开，
 * 那时候只有这份字符串能解释自己。所以这里钉的是几个「扫一眼代码看不出来对错」
 * 的边界——时区、跨小时的时间偏移、文件名清洗——正常路径不重复测。
 */

function utterance(overrides: Partial<InterviewUtterance> = {}): InterviewUtterance {
  return {
    id: 'u',
    sessionId: 's',
    sequence: 1,
    role: 'interviewer',
    text: '',
    cleanedText: null,
    excludedAsEcho: false,
    startMs: 0,
    endMs: 0,
    createdAt: new Date(2026, 8, 20, 10, 59).toISOString(),
    ...overrides,
  }
}

function record(overrides: Partial<InterviewRecord> = {}): InterviewRecord {
  return {
    id: 's',
    preparationId: null,
    preparationName: '示例岗位二面',
    stage: null,
    status: 'completed',
    incompleteReason: null,
    // 用本地时间构造，导出的日期才不会跟着测试机器的时区变
    startedAt: new Date(2026, 8, 20, 10, 59).toISOString(),
    endedAt: new Date(2026, 8, 20, 11, 38).toISOString(),
    durationMs: 2_336_226,
    utteranceCount: 2,
    hasReview: true,
    echoCleanupApplied: false,
    echoRemovedCount: 0,
    echoChangedCount: 0,
    reviewMarkdown: '# 这段复盘不该出现在导出里',
    reviewError: '',
    utterances: [
      utterance({ id: 'a', sequence: 1, role: 'candidate', text: '嗯，喂，能听得到吗？你好。', startMs: 78_000 }),
      utterance({ id: 'b', sequence: 2, role: 'interviewer', text: '你好，我们开始吧。', startMs: 81_000 }),
    ],
    ...overrides,
  }
}

describe('面试记录导出', () => {
  it('原样输出：段落顺序、时间、角色都对，且不带 AI 复盘', () => {
    const markdown = buildInterviewMarkdown(record())

    expect(markdown).toContain('# 示例岗位二面')
    expect(markdown).toContain('- 开始时间：2026-09-20 10:59')
    expect(markdown).toContain('- 时长：38 分 56 秒')
    expect(markdown).toContain('- 转写：2 段')
    expect(markdown).toContain('- 状态：已复盘')
    expect(markdown).not.toContain('这段复盘不该出现在导出里')
    // 顺序就是库里给的顺序，不按 sequence 重排
    expect(markdown.indexOf('**01:18 · 我**')).toBeLessThan(markdown.indexOf('**01:21 · 面试官**'))
    expect(markdown).toContain('嗯，喂，能听得到吗？你好。')
  })

  it('不完整记录把原因写进头部，而不是只留一个状态', () => {
    const markdown = buildInterviewMarkdown(record({
      status: 'incomplete',
      incompleteReason: 'asr_reconnecting',
    }))

    expect(markdown).toContain('- 状态：记录不完整')
    expect(markdown).toContain('- 记录不完整：语音识别服务断线，中途重连过')
  })

  it('轮次来自记录里的快照，紧跟在开始时间后面；不知道轮次时整行不出现', () => {
    const markdown = buildInterviewMarkdown(record({ stage: 2 }))

    expect(markdown).toContain('- 轮次：二面')
    expect(markdown.indexOf('- 轮次：二面')).toBeGreaterThan(markdown.indexOf('- 开始时间：'))
    expect(markdown.indexOf('- 轮次：二面')).toBeLessThan(markdown.indexOf('- 时长：'))
    expect(buildInterviewMarkdown(record({ stage: 0 }))).toContain('- 轮次：AI 面')
    // 通用面试和老记录没有轮次：不写「未设置」凑数
    expect(buildInterviewMarkdown(record())).not.toContain('轮次')
  })

  it('超过一小时的面试，时间偏移自然进位，不从零重来', () => {
    const markdown = buildInterviewMarkdown(record({
      utterances: [utterance({ text: '后半场', startMs: 3_930_000 })],
    }))

    expect(markdown).toContain('**65:30 · 面试官**')
  })

  it('文件名洗掉文件系统里有含义的字符，并且永远不会没有名字', () => {
    expect(buildExportFilename(record({ preparationName: 'A/B:C*D?E' })))
      .toBe('A B C D E 2026-09-20.md')
    expect(buildExportFilename(record({ preparationName: '   ' })))
      .toBe('面试记录 2026-09-20.md')
  })
})
