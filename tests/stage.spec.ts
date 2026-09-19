import { describe, expect, it } from 'vitest'
import { formatStage, nextStage, previousStage } from '../src/shared/stage'

describe('面试阶段', () => {
  it('按序数显示成可读文案', () => {
    expect(formatStage(null)).toBe('未设置')
    expect(formatStage(0)).toBe('AI 面')
    expect(formatStage(1)).toBe('一面')
    expect(formatStage(2)).toBe('二面')
    expect(formatStage(10)).toBe('十面')
  })

  it('轮次没有上限，超出中文数字时退回阿拉伯数字', () => {
    // 不能出现「undefined 面」——有公司真的能面到七八轮以上
    expect(formatStage(11)).toBe('11 面')
    expect(formatStage(20)).toBe('20 面')
  })

  it('推进一轮：未设置 → AI 面 → 一面 → 二面', () => {
    expect(nextStage(null)).toBe(0)
    expect(nextStage(0)).toBe(1)
    expect(nextStage(1)).toBe(2)
    expect(formatStage(nextStage(0))).toBe('一面')
    expect(formatStage(nextStage(null))).toBe('AI 面')
  })

  it('退回一轮：二面 → 一面 → AI 面 → 未设置', () => {
    expect(previousStage(2)).toBe(1)
    expect(previousStage(1)).toBe(0)
    expect(previousStage(0)).toBeNull()
    // 已经是未设置就停在未设置，不会绕回高轮次
    expect(previousStage(null)).toBeNull()
  })

  it('加减互为逆操作', () => {
    for (const stage of [null, 0, 1, 5, 20] as const) {
      expect(previousStage(nextStage(stage))).toBe(stage)
    }
  })
})
