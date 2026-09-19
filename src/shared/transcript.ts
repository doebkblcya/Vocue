/**
 * 服务端明确判停了一句，但没能拿到任何分句文本。
 *
 * 这时绝不能退回累计文本充数：系统音频是一条长连接，
 * `result.text` 是整场对话的累计，会把十几分钟的内容当成一个问题送进模型。
 * 如实留一条占位，位置和数量都保住，用户也知道这里缺了一段。
 */
export const UNRECOGNIZED_SPEECH = '[此处发言未能识别]'

export function isUnrecognizedSpeech(text: string): boolean {
  return text === UNRECOGNIZED_SPEECH
}
