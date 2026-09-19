import { describe, expect, it } from 'vitest'
import { interpretServerFrame, type AsrResponse } from '../src/main/asr/doubao-asr'

/** 系统音频是长连接，这是 result.text 在真实面试里会变成的样子：整场对话 */
const CUMULATIVE = '我我来面试。嗯。哼。嗯 哎，好的。我先跟你聊一下工作内容本身吧。'

describe('ASR 服务端帧的解读', () => {
  it('分句且判停 → final', () => {
    const body: AsrResponse = {
      result: { utterances: [{ text: '你了解过这个部门吗？', definite: true }] },
    }
    expect(interpretServerFrame(body, false, 0, '')).toMatchObject({
      kind: 'final',
      text: '你了解过这个部门吗？',
    })
  })

  it('分句但没有判停 → partial', () => {
    const body: AsrResponse = { result: { utterances: [{ text: '你了解过' }] } }
    expect(interpretServerFrame(body, false, 0, '')).toMatchObject({
      kind: 'partial',
      text: '你了解过',
    })
  })

  /**
   * 这是本次修复的核心。曾经的写法是
   *   lastUtterance?.text || result.text || body.text
   * 于是服务端没给分句时，整场对话的累计文本被当成一道题送进了模型。
   * 你库里 28 分钟那场留下了 2107 / 2705 / 4087 字三条这样的记录。
   */
  it('拿不到分句时绝不采信 result.text', () => {
    const outcome = interpretServerFrame({ result: { text: CUMULATIVE }, is_final: true }, false, 0, '')
    expect(outcome.kind).toBe('unrecognized')
    expect(JSON.stringify(outcome)).not.toContain('我我来面试')
  })

  it('拿不到分句时也绝不采信顶层 text', () => {
    const outcome = interpretServerFrame({ text: CUMULATIVE, definite: true }, false, 0, '')
    expect(outcome.kind).toBe('unrecognized')
    expect(JSON.stringify(outcome)).not.toContain('我我来面试')
  })

  it('没有分句也没有判停 → ignore，不能每帧都刷提示', () => {
    // 静音帧是常态：累计文本里可能还留着之前识别过的内容
    expect(interpretServerFrame({ result: { text: CUMULATIVE } }, false, 0, '').kind).toBe('ignore')
    expect(interpretServerFrame({ text: CUMULATIVE }, false, 0, '').kind).toBe('ignore')
    expect(interpretServerFrame({}, false, 0, '').kind).toBe('ignore')
  })

  it('没有分句但服务端说这句完了 → unrecognized，计入缺失', () => {
    expect(interpretServerFrame({ is_final: true }, false, 0, '').kind).toBe('unrecognized')
    expect(interpretServerFrame({ result: { utterances: [] }, final: true }, false, 0, '').kind)
      .toBe('unrecognized')
  })

  it('最后一包即使没有分句也要结算，回落到最近一次拿到的分句', () => {
    expect(interpretServerFrame({ result: { text: CUMULATIVE } }, true, 0, '上一句')).toMatchObject({
      kind: 'segment-end',
      text: '上一句',
    })
    expect(interpretServerFrame({ result: { utterances: [{ text: '最后一句' }] } }, true, 0, ''))
      .toMatchObject({ kind: 'segment-end', text: '最后一句' })
  })

  it('时间戳按连接起点换算', () => {
    const body: AsrResponse = {
      result: { utterances: [{ text: '好的', definite: true, start_time: 500, end_time: 1500 }] },
    }
    expect(interpretServerFrame(body, false, 60_000, '')).toMatchObject({
      timing: { startMs: 60_500, endMs: 61_500 },
    })
  })
})
