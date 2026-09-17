import { describe, expect, it } from 'vitest'
import { planEchoCleanup } from '../src/main/session/echo-cleanup'
import type { InterviewRole, InterviewUtterance } from '../src/shared/types'

function utterance(
  id: string,
  role: InterviewRole,
  text: string,
  startMs: number,
  endMs: number,
): InterviewUtterance {
  return {
    id,
    sessionId: 'session',
    sequence: Number(id.replace(/\D/g, '')) || 1,
    role,
    text,
    cleanedText: null,
    excludedAsEcho: false,
    startMs,
    endMs,
    createdAt: new Date(0).toISOString(),
  }
}

describe('外放回声后处理', () => {
  it('隐藏同期高度重复的整段麦克风转写', () => {
    const plan = planEchoCleanup([
      utterance('i1', 'interviewer', '请介绍一下你最近负责的项目。', 1000, 4000),
      utterance('c1', 'candidate', '请介绍一下，你最近负责的项目', 1500, 4300),
    ])

    expect(plan).toMatchObject({ removedCount: 1, changedCount: 0 })
    expect(plan.edits).toEqual([
      { utteranceId: 'c1', cleanedText: null, excludedAsEcho: true },
    ])
  })

  it('只移除混合段里的重复问句，保留候选人回答', () => {
    const plan = planEchoCleanup([
      utterance('i1', 'interviewer', '为什么选择我们公司？', 1000, 3000),
      utterance('c1', 'candidate', '为什么选择我们公司？我主要看重团队的技术方向。', 1800, 6500),
    ])

    expect(plan).toMatchObject({ removedCount: 0, changedCount: 1 })
    expect(plan.edits[0]).toEqual({
      utteranceId: 'c1',
      cleanedText: '我主要看重团队的技术方向。',
      excludedAsEcho: false,
    })
  })

  it('保留远离原问题或只有少量关键词相同的回答', () => {
    const plan = planEchoCleanup([
      utterance('i1', 'interviewer', '请介绍一下你最近负责的项目。', 1000, 4000),
      utterance('c1', 'candidate', '我最近负责的是支付系统重构。', 4500, 8000),
      utterance('c2', 'candidate', '请介绍一下你最近负责的项目。', 30_000, 33_000),
    ])

    expect(plan.edits).toEqual([])
  })
})
