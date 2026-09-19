import { describe, expect, it } from 'vitest'
import { interpretServerFrame, type AsrResponse } from '../src/main/asr/doubao-asr'

/** 系统音频是长连接，这是 result.text 在真实面试里会变成的样子：整场对话 */
const CUMULATIVE = '我我来面试。嗯。哼。嗯 哎，好的。我先跟你聊一下工作内容本身吧。'

/**
 * 这几条守的是取值链：曾经写成 lastUtterance?.text || result.text || body.text，
 * 看代码完全合理，但系统音频是长连接，result.text 是整场对话的累计文本——
 * 一触发就把十几分钟的内容当成一道题送进了模型。
 */
describe('ASR 服务端帧的解读', () => {
  it('拿不到分句时，绝不采信 result.text 或顶层 text', () => {
    for (const body of [{ result: { text: CUMULATIVE } }, { text: CUMULATIVE }] as AsrResponse[]) {
      const outcome = interpretServerFrame({ ...body, is_final: true }, false, 0, '')
      expect(outcome.kind).toBe('unrecognized')
      expect(JSON.stringify(outcome)).not.toContain('我我来面试')
    }
  })

  it('没有分句也没有判停就什么都不做，不能每帧都刷提示', () => {
    expect(interpretServerFrame({ result: { text: CUMULATIVE } }, false, 0, '').kind).toBe('ignore')
    expect(interpretServerFrame({}, false, 0, '').kind).toBe('ignore')
  })

  it('服务端判停了却没有分句，才算真的没识别到', () => {
    expect(interpretServerFrame({ is_final: true }, false, 0, '').kind).toBe('unrecognized')
  })
})
