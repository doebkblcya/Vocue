/**
 * 把底层抛出来的技术错误翻译成可直接展示给用户的话。
 *
 * 界面上的错误可以短、可以粗，但不能把 WebSocket 错误码、HTTP 状态码、
 * 服务端原始响应这类东西原样丢给用户。
 */

/** IPC 调用失败时会带上的前缀，例如 "Error invoking remote method 'x': Error: ..." */
const IPC_ERROR_PREFIX = /^Error invoking remote method ['"][^'"]+['"]:\s*/i

const FALLBACK = '操作失败，请重试'

function strip(message: string): string {
  return message
    .replace(IPC_ERROR_PREFIX, '')
    .replace(/^(?:Error:\s*)+/i, '')
    .trim()
}

function pick(message: string): string {
  if (!message) return ''
  // 网络
  if (/ENOTFOUND|EAI_AGAIN|ENETUNREACH|ECONNREFUSED|ETIMEDOUT|socket hang up|fetch failed|Failed to fetch|network|net::/i.test(message)) {
    return '网络连接失败，请检查网络或代理设置'
  }
  // 语音识别连接
  if (/连接豆包语音识别超时/.test(message)) return '连接语音识别服务超时，请检查网络后重试'
  if (/豆包语音连接关闭|WebSocket|1006|1005/i.test(message)) return '语音识别连接中断，请重试'
  if (/等包超时|45000081/.test(message)) return '语音识别连接已超时断开，请重试'
  if (/超时|timeout/i.test(message)) return '请求超时，请重试'
  // 凭证
  if (/401|403|Authentication|unauthorized|api.?key|鉴权|凭证|密钥/i.test(message)) {
    return 'API 凭证无效，请在设置中检查'
  }
  // 额度
  if (/quota|balance|insufficient|额度|余额|欠费/i.test(message)) {
    return '账户额度不足，请检查服务商账户'
  }
  // 服务端
  if (/\b55\d{6}\b|服务繁忙|overload|服务器繁忙|55000031/i.test(message)) {
    return '识别服务暂时不可用，请稍后重试'
  }
  // 音频
  if (/麦克风|microphone|NotAllowedError|Permission/i.test(message)) {
    return '无法使用麦克风，请在系统设置中允许 Vocue 访问麦克风'
  }
  if (/空音频|45000002/.test(message)) return '没有录到声音，请按住按钮说完后再松开'
  if (/音频格式|45000151/.test(message)) return '语音数据格式不正确，请重新启动应用后重试'
  if (/请求参数|45000001/.test(message)) return '语音识别请求参数不正确，请检查服务配置'
  return ''
}

/** 已经是我们自己写的中文提示（不是技术错误），原样保留 */
function isFriendly(message: string): boolean {
  return /[\u4e00-\u9fa5]/.test(message) && !/[A-Za-z]{2,}\s*\(|error|Error|failed|Failed/.test(message)
}

export function toUserMessage(error: unknown, fallback = FALLBACK): string {
  const raw = strip(
    error instanceof Error ? error.message : typeof error === 'string' ? error : '',
  )
  if (!raw) return fallback
  return pick(raw) || (isFriendly(raw) ? raw : fallback)
}
