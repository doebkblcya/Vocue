/**
 * SystemAudioDump 专用处理链：24kHz Int16 立体声 → 16kHz 单声道，
 * 并按 200ms 切成豆包流式 ASR 数据包。
 *
 * 这条链路与渲染进程里的麦克风采集有意分开：两者的数据格式、
 * 运行进程、生命周期和分包长度都不同，不共享重采样状态。
 */
export class SystemAudioProcessor {
  private readonly packetBytes: number
  private pending: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  private stereoRemainder: Buffer<ArrayBufferLike> = Buffer.alloc(0)

  constructor(
    private readonly inputRate = 24_000,
    private readonly outputRate = 16_000,
    packetDurationMs = 200,
  ) {
    this.packetBytes = Math.round((outputRate * packetDurationMs) / 1000) * 2
  }

  pushStereo24k(chunk: Buffer): Buffer[] {
    let source = this.stereoRemainder.length ? Buffer.concat([this.stereoRemainder, chunk]) : chunk
    const usableBytes = source.length - (source.length % 4)
    this.stereoRemainder = source.subarray(usableBytes)
    source = source.subarray(0, usableBytes)
    if (!source.length) return []

    const frameCount = source.length / 4
    const mono = new Int16Array(frameCount)
    for (let frame = 0; frame < frameCount; frame += 1) {
      const left = source.readInt16LE(frame * 4)
      const right = source.readInt16LE(frame * 4 + 2)
      mono[frame] = Math.round((left + right) / 2)
    }

    const outputFrames = Math.floor((frameCount * this.outputRate) / this.inputRate)
    const resampled = Buffer.allocUnsafe(outputFrames * 2)
    for (let index = 0; index < outputFrames; index += 1) {
      const sourcePosition = (index * this.inputRate) / this.outputRate
      const before = Math.floor(sourcePosition)
      const after = Math.min(before + 1, frameCount - 1)
      const fraction = sourcePosition - before
      const sample = mono[before] + (mono[after] - mono[before]) * fraction
      resampled.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample))), index * 2)
    }

    this.pending = Buffer.concat([this.pending, resampled])
    const packets: Buffer[] = []
    while (this.pending.length >= this.packetBytes) {
      packets.push(Buffer.from(this.pending.subarray(0, this.packetBytes)))
      this.pending = this.pending.subarray(this.packetBytes)
    }
    return packets
  }

  reset(): void {
    this.pending = Buffer.alloc(0)
    this.stereoRemainder = Buffer.alloc(0)
  }
}
