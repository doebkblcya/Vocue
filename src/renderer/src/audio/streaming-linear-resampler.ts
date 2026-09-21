/**
 * 有状态的流式线性重采样器。
 *
 * AudioWorklet 会把连续音频拆成很小的块。重采样位置必须跨块保留，
 * 否则每块单独向下取整会持续丢样，并在块边界制造不连续。
 */
export class StreamingLinearResampler {
  private inputRate: number | null = null
  private buffer = new Float32Array(0)
  private sourcePosition = 0

  constructor(private readonly outputRate: number) {
    if (!Number.isFinite(outputRate) || outputRate <= 0) {
      throw new RangeError('输出采样率必须是正数')
    }
  }

  push(input: Float32Array, inputRate: number): number[] {
    if (!Number.isFinite(inputRate) || inputRate <= 0) {
      throw new RangeError('输入采样率必须是正数')
    }
    if (!input.length) return []

    if (this.inputRate !== null && this.inputRate !== inputRate) {
      // AudioContext 的采样率正常不会在运行中改变；若确实改变，新数据应视为新流。
      this.reset()
    }
    this.inputRate = inputRate
    this.append(input)

    const step = inputRate / this.outputRate
    const output: number[] = []
    // 分数位置需要下一个输入样本做插值，因此最后一个样本留到下一块。
    while (this.sourcePosition + 1 < this.buffer.length) {
      output.push(this.sampleAt(this.sourcePosition))
      this.sourcePosition += step
    }

    this.discardConsumedInput()
    return output
  }

  /** 在输入流结束时，用最后一个样本补齐至流的实际终点，并清空状态。 */
  flush(): number[] {
    if (this.inputRate === null || !this.buffer.length) {
      this.reset()
      return []
    }

    const step = this.inputRate / this.outputRate
    const output: number[] = []
    while (this.sourcePosition < this.buffer.length) {
      output.push(this.sampleAt(this.sourcePosition))
      this.sourcePosition += step
    }
    this.reset()
    return output
  }

  reset(): void {
    this.inputRate = null
    this.buffer = new Float32Array(0)
    this.sourcePosition = 0
  }

  private append(input: Float32Array): void {
    if (!this.buffer.length) {
      this.buffer = input.slice()
      return
    }

    const combined = new Float32Array(this.buffer.length + input.length)
    combined.set(this.buffer)
    combined.set(input, this.buffer.length)
    this.buffer = combined
  }

  private sampleAt(position: number): number {
    const before = Math.floor(position)
    const after = Math.min(before + 1, this.buffer.length - 1)
    const fraction = position - before
    return this.buffer[before] + (this.buffer[after] - this.buffer[before]) * fraction
  }

  private discardConsumedInput(): void {
    const consumed = Math.min(Math.floor(this.sourcePosition), this.buffer.length)
    if (!consumed) return
    this.buffer = this.buffer.slice(consumed)
    this.sourcePosition -= consumed
  }
}
