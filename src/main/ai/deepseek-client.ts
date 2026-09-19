import type { AppSettings } from '../../shared/types'
import { toUserMessage } from '../../shared/error-message'

export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com'
export const DEEPSEEK_MODEL = 'deepseek-flash'

/** 面试实时回答：首字等这么久还不出来，这一轮就已经废了，早点报错比干等好 */
export const FIRST_TOKEN_TIMEOUT_MS = 8_000
/** 面试实时回答的整体上限。纯安全网：一旦开始出字，用户已经在读了，掐断反而更亏 */
export const STREAM_TIMEOUT_MS = 60_000
/** 非流式调用的整体上限。复盘本来就慢，给宽一点 */
export const COMPLETE_TIMEOUT_MS = 120_000
/**
 * 面试实时回答的输出上限。提示词要求约 310 个汉字（约 250 token），
 * 2048 留足思考空间，同时挡住失控的长篇大论。
 *
 * 注意：**不要**套到复盘生成上——复盘正文实测有 3022 字，套上会被拦腰截断。
 */
export const ANSWER_MAX_TOKENS = 2_048

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

  async complete(
    messages: ChatMessage[],
    options?: { json?: boolean; thinkingEffort?: AppSettings['thinkingEffort'] },
  ): Promise<string> {
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, COMPLETE_TIMEOUT_MS)
    try {
      const response = await this.request({
        messages,
        stream: false,
        json: options?.json,
        thinkingEffort: options?.thinkingEffort,
      }, controller.signal)
      const data = (await response.json()) as ChatCompletionResponse
      const content = data.choices?.[0]?.message?.content
      if (!content) throw new Error(data.error?.message || 'DeepSeek 没有返回内容')
      return content
    } catch (error) {
      if (timedOut && (error as Error)?.name === 'AbortError') {
        throw new Error('请求超时：模型响应时间过长，请重试')
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  async stream(
    messages: ChatMessage[],
    onDelta: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const controller = new AbortController()
    let timedOut = ''
    // 调用方取消（来了新问题、面试结束）要能立刻传下去
    const forwardAbort = (): void => controller.abort()
    signal?.addEventListener('abort', forwardAbort, { once: true })

    // 首字超时：只盯「迟迟不出字」。一旦出了第一个字就撤掉，
    // 后面交给整体上限兜着——已经在读的内容不该被掐。
    let started = false
    const firstTokenTimer = setTimeout(() => {
      if (started) return
      timedOut = '生成超时：模型迟迟没有返回内容，请重试'
      controller.abort()
    }, FIRST_TOKEN_TIMEOUT_MS)
    const overallTimer = setTimeout(() => {
      timedOut = '生成超时：回答时间过长，已中止'
      controller.abort()
    }, STREAM_TIMEOUT_MS)

    try {
      const response = await this.request(
        { messages, stream: true, maxTokens: ANSWER_MAX_TOKENS },
        controller.signal,
      )
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
          if (!delta) continue
          if (!started) {
            started = true
            clearTimeout(firstTokenTimer)
          }
          result += delta
          onDelta(delta)
        }
        if (done) break
      }
      return result
    } catch (error) {
      // 我们自己的超时被 fetch 包成了 AbortError，换成能看懂的提示。
      // 调用方主动取消时 timedOut 为空，AbortError 原样上抛，
      // 上层靠它区分「被打断」和「真出错」。
      if (timedOut && (error as Error)?.name === 'AbortError') throw new Error(timedOut)
      throw error
    } finally {
      clearTimeout(firstTokenTimer)
      clearTimeout(overallTimer)
      signal?.removeEventListener('abort', forwardAbort)
    }
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
    input: {
      messages: ChatMessage[]
      stream: boolean
      json?: boolean
      thinkingEffort?: AppSettings['thinkingEffort']
      maxTokens?: number
    },
    signal?: AbortSignal,
  ): Promise<Response> {
    if (!this.settings.deepseekApiKey) throw new Error('尚未配置 DeepSeek API Key')
    const thinkingEffort = input.thinkingEffort ?? this.settings.thinkingEffort
    const thinkingEnabled = thinkingEffort !== 'disabled'
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
          ? { reasoning_effort: thinkingEffort }
          : { temperature: 0.45 }),
        ...(input.json ? { response_format: { type: 'json_object' } } : {}),
        ...(input.maxTokens ? { max_tokens: input.maxTokens } : {}),
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
