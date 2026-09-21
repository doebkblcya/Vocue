import { describe, expect, it } from 'vitest'
import { StreamingLinearResampler } from '../src/renderer/src/audio/streaming-linear-resampler'

function resampleInChunks(input: Float32Array, inputRate: number, chunkSize: number): number[] {
  const resampler = new StreamingLinearResampler(16_000)
  const output: number[] = []
  for (let offset = 0; offset < input.length; offset += chunkSize) {
    output.push(...resampler.push(input.subarray(offset, offset + chunkSize), inputRate))
  }
  output.push(...resampler.flush())
  return output
}

describe('麦克风流式重采样', () => {
  it('48kHz 输入按 AudioWorklet 分块后仍得到连续、准确的 16kHz 结果', () => {
    const input = Float32Array.from(
      { length: 48_000 },
      (_, index) => Math.sin((index / 48_000) * Math.PI * 2 * 440),
    )

    const whole = resampleInChunks(input, 48_000, input.length)
    const chunked = resampleInChunks(input, 48_000, 128)

    expect(whole).toHaveLength(16_000)
    expect(chunked).toHaveLength(16_000)
    for (let index = 0; index < whole.length; index += 1) {
      expect(chunked[index]).toBeCloseTo(whole[index], 7)
    }
  })
})
