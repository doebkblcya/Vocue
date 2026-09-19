import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ANSWER_MAX_TOKENS,
  DeepSeekClient,
  FIRST_TOKEN_TIMEOUT_MS,
  STREAM_TIMEOUT_MS,
} from '../src/main/ai/deepseek-client'
import type { AppSettings } from '../src/shared/types'

const baseSettings: AppSettings = {
  deepseekApiKey: 'test-key',
  doubaoApiKey: 'test-key',
  hideFromScreenCapture: true,
  theme: 'system',
  thinkingEffort: 'disabled',
}

afterEach(() => vi.unstubAllGlobals())

/**
 * 阈值是约定死的数，改动必须是特意的。
 * max_tokens 只能挂在流式路径上：复盘正文实测 3022 字，套 2048 会被
 * 拦腰截断——这个坑读代码看不出来。
 */
describe('DeepSeekClient 输出上限', () => {
  it('三个阈值不被动，且上限只加在面试实时回答上', async () => {
    expect([FIRST_TOKEN_TIMEOUT_MS, STREAM_TIMEOUT_MS, ANSWER_MAX_TOKENS])
      .toEqual([8_000, 60_000, 2_048])

    const streamMock = mockFetch(
      'data: {"choices":[{"delta":{"content":"<quick>好</quick>"}}]}\n\ndata: [DONE]\n\n',
    )
    await new DeepSeekClient(baseSettings).stream(
      [{ role: 'user', content: '测试' }],
      () => undefined,
    )
    expect(requestBody(streamMock).max_tokens).toBe(ANSWER_MAX_TOKENS)

    const completeMock = mockFetch(
      JSON.stringify({ choices: [{ message: { content: '连接成功' } }] }),
    )
    await new DeepSeekClient(baseSettings).complete([{ role: 'user', content: '测试' }])
    expect(requestBody(completeMock).max_tokens).toBeUndefined()
  })
})

function mockFetch(body: string): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => new Response(body, { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const init = fetchMock.mock.calls[0][1] as RequestInit
  return JSON.parse(String(init.body)) as Record<string, unknown>
}
