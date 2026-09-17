import { describe, expect, it } from 'vitest'
import { InterviewSession } from '../src/main/session/interview-session'
import type { ChatMessage } from '../src/main/ai/deepseek-client'

interface PendingStream {
  messages: ChatMessage[]
  signal: AbortSignal
  onDelta: (delta: string) => void
  resolve: (answer: string) => void
  reject: (error: Error) => void
}

function createSession(): InterviewSession {
  return new InterviewSession(
    {} as ConstructorParameters<typeof InterviewSession>[0],
    {} as ConstructorParameters<typeof InterviewSession>[1],
  )
}

describe('InterviewSession 回答并发', () => {
  it('新问题会中止旧回答并忽略旧流的迟到内容', async () => {
    const pending: PendingStream[] = []
    const session = createSession()
    const internals = session as unknown as {
      deepseek: {
        stream: (
          messages: ChatMessage[],
          onDelta: (delta: string) => void,
          signal: AbortSignal,
        ) => Promise<string>
      }
      systemPrompt: string
      handleFinalTranscript: (text: string) => void
    }
    internals.systemPrompt = '测试提示词'
    internals.deepseek = {
      stream: (_messages, onDelta, signal) => new Promise<string>((resolve, reject) => {
        const item = { messages: _messages, signal, onDelta, resolve, reject }
        pending.push(item)
        signal.addEventListener('abort', () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        }, { once: true })
      }),
    }

    internals.handleFinalTranscript('第一个问题')
    expect(pending).toHaveLength(1)
    pending[0].onDelta('旧回答')
    expect(session.getState().answer).toBe('旧回答')

    internals.handleFinalTranscript('第二个问题')
    expect(pending).toHaveLength(2)
    expect(pending[0].signal.aborted).toBe(true)
    expect(pending[1].messages).toHaveLength(2)

    pending[0].onDelta('不应出现')
    pending[1].onDelta('新回答')
    pending[1].resolve('新回答完成')
    await Promise.resolve()
    await Promise.resolve()

    expect(session.getState()).toMatchObject({
      finalTranscript: '第二个问题',
      answer: '新回答完成',
      answerDetail: '新回答完成',
      generating: false,
    })
  })

  it('停止会话时清除上一场的转写和回答', async () => {
    const session = createSession()
    const internals = session as unknown as {
      patchState: (patch: { finalTranscript: string; answer: string }) => void
    }
    internals.patchState({ finalTranscript: '旧问题', answer: '旧回答' })

    await session.stop()

    expect(session.getState()).toMatchObject({
      finalTranscript: '',
      answer: '',
      answerSummary: '',
      answerDetail: '',
      generating: false,
    })
  })

  it('下一题携带最近完成的 4 轮问题与 AI 建议回答', async () => {
    const calls: ChatMessage[][] = []
    const session = createSession()
    const internals = session as unknown as {
      deepseek: {
        stream: (
          messages: ChatMessage[],
          onDelta: (delta: string) => void,
          signal: AbortSignal,
        ) => Promise<string>
      }
      systemPrompt: string
      handleFinalTranscript: (text: string) => void
    }
    internals.systemPrompt = '测试提示词'
    internals.deepseek = {
      stream: async (messages, onDelta) => {
        calls.push(messages)
        const answer = `<quick>- 回答 ${calls.length}</quick><detail>详细回答 ${calls.length}</detail>`
        onDelta(answer)
        return answer
      },
    }

    internals.handleFinalTranscript('第一个问题')
    await Promise.resolve()
    await Promise.resolve()
    internals.handleFinalTranscript('第二个问题')
    await Promise.resolve()

    expect(calls[1].map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ])
    expect(calls[1][1].content).toBe('第一个问题')
    expect(calls[1][2].content).toContain('回答 1')
    expect(calls[1][3].content).toBe('第二个问题')
  })

  it('截屏提问把图片放在 user message 中', async () => {
    let sentMessages: ChatMessage[] = []
    const session = createSession()
    const internals = session as unknown as {
      deepseek: {
        stream: (
          messages: ChatMessage[],
          onDelta: (delta: string) => void,
          signal: AbortSignal,
        ) => Promise<string>
      }
      patchState: (patch: { status: 'ready' }) => void
    }
    internals.patchState({ status: 'ready' })
    internals.deepseek = {
      stream: async (messages, onDelta) => {
        sentMessages = messages
        const answer = '<quick>- 图片结论</quick><detail>图片详情</detail>'
        onDelta(answer)
        return answer
      },
    }

    session.answerScreenshot('data:image/png;base64,dGVzdA==', '显示器 1')
    await Promise.resolve()
    await Promise.resolve()

    const content = sentMessages[1].content
    expect(Array.isArray(content)).toBe(true)
    expect(content).toEqual(expect.arrayContaining([
      { type: 'image_url', image_url: { url: 'data:image/png;base64,dGVzdA==', detail: 'original' } },
    ]))
    expect(session.getState()).toMatchObject({
      finalTranscript: '屏幕截图提问',
      answerSummary: '- 图片结论',
      answerDetail: '图片详情',
    })
  })
})
