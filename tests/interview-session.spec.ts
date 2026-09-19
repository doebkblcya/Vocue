import { describe, expect, it } from 'vitest'
import { InterviewSession } from '../src/main/session/interview-session'
import type { ChatMessage } from '../src/main/ai/deepseek-client'

interface PendingStream {
  signal: AbortSignal
  onDelta: (delta: string) => void
  resolve: (answer: string) => void
  reject: (error: Error) => void
}

/**
 * 「只保留最新问题」是靠一个自增 generation 守的：旧流即使迟到也不能
 * 覆盖新回答。这套时序读代码看不出对错，出错的后果是答案和转写错位。
 */
describe('InterviewSession 回答并发', () => {
  it('新问题中止旧回答，并丢弃旧流的迟到内容', async () => {
    const pending: PendingStream[] = []
    const session = new InterviewSession(
      {} as ConstructorParameters<typeof InterviewSession>[0],
      {} as ConstructorParameters<typeof InterviewSession>[1],
    )
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
        pending.push({ signal, onDelta, resolve, reject })
        signal.addEventListener('abort', () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        }, { once: true })
      }),
    }

    internals.handleFinalTranscript('第一个问题')
    pending[0].onDelta('旧回答')
    expect(session.getState().answer).toBe('旧回答')

    internals.handleFinalTranscript('第二个问题')
    expect(pending).toHaveLength(2)
    expect(pending[0].signal.aborted).toBe(true)

    pending[0].onDelta('不应出现')
    pending[1].onDelta('新回答')
    pending[1].resolve('新回答完成')
    await Promise.resolve()
    await Promise.resolve()

    expect(session.getState()).toMatchObject({
      finalTranscript: '第二个问题',
      answer: '新回答完成',
      generating: false,
    })
  })
})
