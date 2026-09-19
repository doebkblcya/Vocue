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

describe('DeepSeekClient 输出上限', () => {
  it('面试实时回答带上 token 上限，挡住失控的长篇大论', async () => {
    const fetchMock = mockFetchStream()
    await new DeepSeekClient(baseSettings).stream(
      [{ role: 'user', content: '测试' }],
      () => undefined,
    )
    expect(requestBody(fetchMock).max_tokens).toBe(2048)
  })

  it('复盘这类非流式调用不带上限——复盘正文实测 3022 字，套上会被截断', async () => {
    const fetchMock = mockFetch()
    await new DeepSeekClient(baseSettings).complete([{ role: 'user', content: '测试' }])
    expect(requestBody(fetchMock).max_tokens).toBeUndefined()
  })
})

describe('DeepSeekClient 超时', () => {
  it('三个阈值就是约定好的那三个数', () => {
    expect(FIRST_TOKEN_TIMEOUT_MS).toBe(8_000)
    expect(STREAM_TIMEOUT_MS).toBe(60_000)
    expect(ANSWER_MAX_TOKENS).toBe(2_048)
  })

  it('首字迟迟不来时按首字超时报错，而不是一直干等', async () => {
    vi.useFakeTimers()
    try {
      stubHangingFetch()
      const promise = new DeepSeekClient(baseSettings).stream(
        [{ role: 'user', content: '测试' }],
        () => undefined,
      )
      const assertion = expect(promise).rejects.toThrow('模型迟迟没有返回内容')
      await vi.advanceTimersByTimeAsync(FIRST_TOKEN_TIMEOUT_MS)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })

  it('调用方主动取消时保持 AbortError，不能被当成超时', async () => {
    vi.useFakeTimers()
    try {
      stubHangingFetch()
      const controller = new AbortController()
      const promise = new DeepSeekClient(baseSettings).stream(
        [{ role: 'user', content: '测试' }],
        () => undefined,
        controller.signal,
      )
      // 上层靠 AbortError 区分「被新问题打断」和「真出错」
      const assertion = expect(promise).rejects.toMatchObject({ name: 'AbortError' })
      controller.abort()
      await vi.advanceTimersByTimeAsync(0)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })
})

function mockFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({
    choices: [{ message: { content: '连接成功' } }],
  }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function mockFetchStream(): ReturnType<typeof vi.fn> {
  const body = [
    'data: {"choices":[{"delta":{"content":"<quick>你好</quick>"}}]}',
    '',
    'data: [DONE]',
    '',
  ].join('\n')
  const fetchMock = vi.fn(async () => new Response(body, { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** 模拟一个「永远不回应、但尊重取消信号」的服务端 */
function stubHangingFetch(): void {
  vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
    const fail = (): void =>
      reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))
    if (init.signal?.aborted) fail()
    else init.signal?.addEventListener('abort', fail)
  })))
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const init = fetchMock.mock.calls[0][1] as RequestInit
  return JSON.parse(String(init.body)) as Record<string, unknown>
}
