import { describe, expect, it } from 'vitest'
import { getErrorMessage } from '../src/renderer/src/error-message'
import { toUserMessage } from '../src/shared/error-message'

/**
 * 这里靠正则把技术错误翻成人话，映射表读代码看不出哪个分支会漏。
 * 底线是：英文原文和 HTTP 状态码不能漏到界面上。
 */
describe('技术错误翻译', () => {
  it('剥掉 Electron IPC 的包装，网络类错误不把英文丢给用户', () => {
    expect(getErrorMessage(new Error(
      "Error invoking remote method 'documents:extract': Error: 这份 PDF 没有可提取的文字",
    ))).toBe('这份 PDF 没有可提取的文字')
    expect(toUserMessage(new Error('getaddrinfo ENOTFOUND openspeech.bytedance.com')))
      .toBe('网络连接失败，请检查网络或代理设置')
  })

  it('凭证错误不暴露 HTTP 状态码和服务端原文', () => {
    const message = toUserMessage(new Error(
      'DeepSeek 请求失败 (HTTP 401)：{"error":{"message":"Authentication Fails"}}',
    ))
    expect(message).toBe('API 凭证无效，请在设置中检查')
    expect(message).not.toContain('401')
    expect(message).not.toContain('Authentication')
  })
})
