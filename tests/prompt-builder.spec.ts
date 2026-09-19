import { describe, expect, it } from 'vitest'
import { parseInterviewAnswer } from '../src/main/ai/prompt-builder'

/**
 * 回答是边流边解析的，标签经常只到一半（`<qui`、`<quick>…<`），
 * 这里要保证半截标签既不会漏进正文也不会把内容吃掉。读代码看不出。
 */
describe('流式回答的标签拆分', () => {
  it('完整标签正常拆开', () => {
    expect(parseInterviewAnswer('<quick>\n- 先讲结论\n</quick>\n<detail>\n详细内容'))
      .toEqual({ summary: '- 先讲结论', detail: '详细内容' })
  })

  it('标签只到一半时不吐出残缺内容', () => {
    expect(parseInterviewAnswer('<quick>\n- 还在流式输出<'))
      .toEqual({ summary: '- 还在流式输出', detail: '' })
    expect(parseInterviewAnswer('<qui')).toEqual({ summary: '', detail: '' })
  })
})
