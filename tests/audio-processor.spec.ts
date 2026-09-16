import { describe, expect, it } from 'vitest'
import { PcmAudioProcessor } from '../src/main/audio/audio-processor'

describe('PcmAudioProcessor', () => {
  it('将 48kHz 双声道 PCM 转成 16kHz 单声道 200ms 数据包', () => {
    const processor = new PcmAudioProcessor()
    // 100ms 的 48kHz 立体声输入，产出 100ms 的 16kHz 单声道（3200 字节），不足一包
    const input = Buffer.alloc(4800 * 4)
    for (let index = 0; index < 4800; index += 1) {
      input.writeInt16LE(1200, index * 4)
      input.writeInt16LE(800, index * 4 + 2)
    }

    expect(processor.pushStereo48k(input)).toHaveLength(0)

    const packets = processor.pushStereo48k(input)
    expect(packets).toHaveLength(1)
    expect(packets[0]).toHaveLength(6400)
    expect(packets[0].readInt16LE(0)).toBe(1000)
  })

  it('能够拼接不对齐的输入块', () => {
    const processor = new PcmAudioProcessor()
    const input = Buffer.alloc(4800 * 4, 0)
    const packets = [
      ...processor.pushStereo48k(input.subarray(0, 97)),
      ...processor.pushStereo48k(input.subarray(97)),
      ...processor.pushStereo48k(input),
    ]
    expect(packets).toHaveLength(1)
    expect(packets[0]).toHaveLength(6400)
  })
})
