import { describe, expect, it } from 'vitest'
import { describeStartupFailure } from '../src/main/audio/system-audio-capture'

describe('系统音频工具启动错误', () => {
  it('把 stdout 中的屏幕录制权限错误翻译成可操作提示', () => {
    const error = describeStartupFailure(
      'Screen recording permission required! Permission denied. Exiting.',
      '',
      1,
    )

    expect(error.message).toContain('屏幕与系统音频录制')
    expect(error.message).toContain('SystemAudioDump')
  })
})
