import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeepSeekClient } from '../src/main/ai/deepseek-client'
import type { AppSettings } from '../src/shared/types'

const baseSettings: AppSettings = {
  deepseekApiKey: 'test-key',
  doubaoApiKey: 'test-key',
  hideFromScreenCapture: true,
  theme: 'system',
  thinkingEffort: 'disabled',
}

afterEach(() => vi.unstubAllGlobals())

describe('DeepSeekClient 思考模式', () => {
  it('关闭思考时发送 temperature,不发送 reasoning_effort', async () => {
    const fetchMock = mockFetch()
    await new DeepSeekClient(baseSettings).complete([
      { role: 'user', content: '测试' },
    ])

    const body = requestBody(fetchMock)
    expect(body.thinking).toEqual({ type: 'disabled' })
    expect(body.temperature).toBe(0.45)
    expect(body.reasoning_effort).toBeUndefined()
  })

  it('开启思考时发送强度且不发送无效的 temperature', async () => {
    const fetchMock = mockFetch()
    await new DeepSeekClient({ ...baseSettings, thinkingEffort: 'high' }).complete([
      { role: 'user', content: '测试' },
    ])

    const body = requestBody(fetchMock)
    expect(body.thinking).toEqual({ type: 'enabled' })
    expect(body.reasoning_effort).toBe('high')
    expect(body.temperature).toBeUndefined()
  })
})

function mockFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({
    choices: [{ message: { content: '连接成功' } }],
  }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const init = fetchMock.mock.calls[0][1] as RequestInit
  return JSON.parse(String(init.body)) as Record<string, unknown>
}
