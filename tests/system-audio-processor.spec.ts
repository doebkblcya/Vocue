import { describe, expect, it } from 'vitest'
import { SystemAudioProcessor } from '../src/main/audio/system-audio-processor'

describe('系统音频 PCM 处理', () => {
  it('把 SystemAudioDump 的 24kHz 立体声转换成 16kHz 单声道 200ms 数据包', () => {
    const processor = new SystemAudioProcessor()
    const stereoFrames = 24_000 / 10 // 100ms
    const input = Buffer.alloc(stereoFrames * 4)
    for (let frame = 0; frame < stereoFrames; frame += 1) {
      input.writeInt16LE(1000, frame * 4)
      input.writeInt16LE(3000, frame * 4 + 2)
    }

    expect(processor.pushStereo24k(input)).toHaveLength(0)
    const packets = processor.pushStereo24k(input)

    expect(packets).toHaveLength(1)
    expect(packets[0]).toHaveLength(16_000 / 5 * 2)
    expect(packets[0].readInt16LE(0)).toBe(2000)
    expect(packets[0].readInt16LE(packets[0].length - 2)).toBe(2000)
  })

  it('能够拼接不对齐的输入块', () => {
    const processor = new SystemAudioProcessor()
    const input = Buffer.alloc(2400 * 4, 0)
    const packets = [
      ...processor.pushStereo24k(input.subarray(0, 97)),
      ...processor.pushStereo24k(input.subarray(97)),
      ...processor.pushStereo24k(input),
    ]

    expect(packets).toHaveLength(1)
    expect(packets[0]).toHaveLength(6400)
  })
})
