import { describe, expect, it } from 'vitest'
import { getErrorMessage } from '../src/renderer/src/error-message'
import { toUserMessage } from '../src/shared/error-message'

describe('getErrorMessage', () => {
  it('removes Electron IPC implementation details', () => {
    const error = new Error(
      "Error invoking remote method 'documents:extract': Error: 这份 PDF 没有可提取的文字",
    )
    expect(getErrorMessage(error)).toBe('这份 PDF 没有可提取的文字')
  })

  it('keeps an already user-facing message', () => {
    expect(getErrorMessage(new Error('请先完成 API 配置'))).toBe('请先完成 API 配置')
  })

  it('uses a safe fallback for unknown values', () => {
    expect(getErrorMessage({})).toBe('操作失败，请重试')
  })
})

describe('技术错误翻译', () => {
  it('网络类错误不把英文原文丢给用户', () => {
    expect(toUserMessage(new Error('fetch failed'))).toBe('网络连接失败，请检查网络或代理设置')
    expect(toUserMessage(new Error('getaddrinfo ENOTFOUND openspeech.bytedance.com'))).toBe(
      '网络连接失败，请检查网络或代理设置',
    )
  })

  it('语音识别连接错误翻译成可读提示', () => {
    expect(toUserMessage(new Error('豆包语音连接关闭 (1006)'))).toBe('语音识别连接中断，请重试')
    expect(toUserMessage(new Error('连接豆包语音识别超时'))).toBe(
      '连接语音识别服务超时，请检查网络后重试',
    )
  })

  it('凭证错误不暴露 HTTP 状态码和服务端原文', () => {
    const raw = new Error(
      'DeepSeek 请求失败 (HTTP 401)：{"error":{"message":"Authentication Fails"}}',
    )
    const message = toUserMessage(raw)
    expect(message).toBe('API 凭证无效，请在设置中检查')
    expect(message).not.toContain('401')
    expect(message).not.toContain('Authentication')
  })

  it('保留我们自己写的应用内提示', () => {
    expect(toUserMessage(new Error('语音识别已断开，刚才这段没有识别，请重说'))).toBe(
      '语音识别已断开，刚才这段没有识别，请重说',
    )
  })
})
