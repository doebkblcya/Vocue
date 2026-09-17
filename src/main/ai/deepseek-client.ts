import type { AppSettings } from '../../shared/types'
import { toUserMessage } from '../../shared/error-message'

export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com'
export const DEEPSEEK_MODEL = 'deepseek-flash'

export type MessageContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string; detail: 'original' } }
    >

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: MessageContent
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>
  error?: { message?: string }
}

export class DeepSeekClient {
  constructor(private readonly settings: AppSettings) {}

  async complete(messages: ChatMessage[], options?: { json?: boolean }): Promise<string> {
    const response = await this.request({ messages, stream: false, json: options?.json })
    const data = (await response.json()) as ChatCompletionResponse
    const content = data.choices?.[0]?.message?.content
    if (!content) throw new Error(data.error?.message || 'DeepSeek 没有返回内容')
    return content
  }

  async stream(
    messages: ChatMessage[],
    onDelta: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const response = await this.request({ messages, stream: true }, signal)
    if (!response.body) throw new Error('DeepSeek 流式响应不可用')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let result = ''

    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        const event = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>
          error?: { message?: string }
        }
        // 流中途返回的错误同样不适合直接上界面，统一翻译
        if (event.error?.message) throw new Error(toUserMessage(event.error.message))
        const delta = event.choices?.[0]?.delta?.content ?? ''
        if (delta) {
          result += delta
          onDelta(delta)
        }
      }
      if (done) break
    }
    return result
  }

  async test(): Promise<void> {
    await this.complete([
      { role: 'system', content: '只回复“连接成功”。' },
      { role: 'user', content: '测试连接' },
    ])
  }

  async recognizeImage(bytes: Uint8Array, mimeType: string): Promise<string> {
    const dataUrl = `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`
    return this.complete([
      {
        role: 'system',
        content: '你是文字识别助手。',
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: [
              '提取并整理图片中的岗位描述，只输出清理后的 JD 正文。',
              '保留岗位名称、地点、薪资、经验与学历要求、岗位介绍、岗位职责、任职要求、加分项和福利。',
              '删除截图日期、招聘平台名称或品牌、正在招聘提示、二维码与扫码提示、求职口号、下载或联系引导、页面导航和其他界面文案。',
              '修正明显的 OCR 标点、空格、编号和换行问题，但不要总结、改写、补充或推测岗位内容。',
            ].join('\n'),
          },
          { type: 'image_url', image_url: { url: dataUrl, detail: 'original' } },
        ],
      },
    ])
  }

  private async request(
    input: { messages: ChatMessage[]; stream: boolean; json?: boolean },
    signal?: AbortSignal,
  ): Promise<Response> {
    if (!this.settings.deepseekApiKey) throw new Error('尚未配置 DeepSeek API Key')
    const thinkingEnabled = this.settings.thinkingEffort !== 'disabled'
    const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.settings.deepseekApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: input.messages,
        stream: input.stream,
        thinking: { type: thinkingEnabled ? 'enabled' : 'disabled' },
        ...(thinkingEnabled
          ? { reasoning_effort: this.settings.thinkingEffort }
          : { temperature: 0.45 }),
        ...(input.json ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal,
    })
    if (!response.ok) {
      const body = await response.text()
      let detail = body
      try {
        const parsed = JSON.parse(body) as { error?: { message?: string } }
        detail = parsed.error?.message || body
      } catch {
        // 保留原始响应文本
      }
      // 原始详情只用于日志，界面拿到的是翻译后的可读提示
      throw new Error(
        `DeepSeek 请求失败 (HTTP ${response.status})${detail ? `：${detail.slice(0, 300)}` : ''}`,
      )
    }
    return response
  }

  /** 把一次 DeepSeek 调用的失败翻译成界面可直接展示的提示 */
  static describeError(error: unknown): string {
    return toUserMessage(error, '生成回答失败，请重试')
  }
}
