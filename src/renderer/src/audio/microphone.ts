import { StreamingLinearResampler } from './streaming-linear-resampler'

class MicrophoneCapture {
  private context: AudioContext | null = null
  private stream: MediaStream | null = null
  private sending = false
  private continuous = false
  private ready = false
  private samples: number[] = []
  private readonly resampler = new StreamingLinearResampler(16_000)
  /** 串行化按下/松开，避免首次授权期间重复初始化或松开事件越过按下事件。 */
  private transition: Promise<void> = Promise.resolve()

  setSending(active: boolean): Promise<void> {
    const operation = this.transition.then(() => this.applySending(active))
    // 一次失败不能让后续所有按键操作都卡在 rejected promise 上。
    this.transition = operation.catch(() => undefined)
    return operation
  }

  startContinuous(): Promise<void> {
    const operation = this.transition.then(async () => {
      if (this.continuous) return
      if (!this.context) await this.initialize()
      this.continuous = true
      this.ready = true
      this.samples = []
      this.resampler.reset()
    })
    this.transition = operation.catch(() => undefined)
    return operation
  }

  stopContinuous(): Promise<void> {
    const operation = this.transition.then(async () => {
      if (this.continuous && this.ready) this.sendRemainingPacket()
      this.continuous = false
      this.ready = false
      this.samples = []
      this.resampler.reset()
      await this.releaseResources()
    })
    this.transition = operation.catch(() => undefined)
    return operation
  }

  private async applySending(active: boolean): Promise<void> {
    if (active) {
      if (this.sending) return
      if (!this.context) await this.initialize()
      this.sending = true
      this.ready = false
      this.samples = []
      this.resampler.reset()
      try {
        await window.vocue.session.setMicrophoneActive(true)
        this.ready = true
        this.sendCompletePackets()
      } catch (error) {
        this.sending = false
        this.ready = false
        this.samples = []
        this.resampler.reset()
        throw error
      }
      return
    }

    if (!this.sending) return
    if (this.ready) this.sendRemainingPacket()
    this.sending = false
    this.ready = false
    this.samples = []
    // 先发完尾包，再通知主进程发「最后一包」并进入收尾态。
    // 主进程按顺序把两者送出去，所以不需要额外的收尾调用。
    await window.vocue.session.setMicrophoneActive(false)
  }

  stop(): Promise<void> {
    const operation = this.transition
      .catch(() => undefined)
      .then(async () => {
        if (this.sending) {
          try {
            await this.applySending(false)
          } catch {
            // 窗口正在卸载时只需确保本地资源释放
          }
        }
        this.sending = false
        this.continuous = false
        this.ready = false
        this.samples = []
        this.resampler.reset()
        await this.releaseResources()
      })
    this.transition = operation.catch(() => undefined)
    return operation
  }

  /**
   * 采集只负责把麦克风的声音原样取回来，不做任何加工。
   *
   * 下面三个开关必须**显式**写 false：不写不等于关闭，Chrome 的默认值是开，
   * 省略它们反而会打开系统级处理。降噪、判停、顺滑都是 ASR 端的事
   * （那边有 enableDdc 这类看得见、能写注释的开关），客户端再处理一遍等于
   * 同一个信号被加工两次，而且这条处理链在 Electron 里生不生效都不可见。
   */
  private async initialize(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    })
    this.context = new AudioContext()
    await this.context.audioWorklet.addModule('/pcm-worklet.js')
    const source = this.context.createMediaStreamSource(this.stream)
    const worklet = new AudioWorkletNode(this.context, 'pcm-capture-processor')
    const silent = this.context.createGain()
    silent.gain.value = 0
    worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
      if (this.sending || this.continuous) {
        this.process(event.data, this.context?.sampleRate ?? 48_000)
      }
    }
    source.connect(worklet)
    worklet.connect(silent).connect(this.context.destination)
  }

  private process(input: Float32Array, inputRate: number): void {
    const output = this.resampler.push(input, inputRate)
    for (const value of output) {
      this.samples.push(Math.max(-1, Math.min(1, value)))
    }

    if (!this.ready) {
      if (this.samples.length > 48_000) this.samples = this.samples.slice(-48_000)
      return
    }
    this.sendCompletePackets()
  }

  private sendCompletePackets(): void {
    while (this.samples.length >= 1600) {
      this.sendPacket(this.samples.splice(0, 1600))
    }
  }

  private sendRemainingPacket(): void {
    for (const value of this.resampler.flush()) {
      this.samples.push(Math.max(-1, Math.min(1, value)))
    }
    this.sendCompletePackets()
    if (!this.samples.length) return
    const packet = this.samples.splice(0)
    while (packet.length < 1600) packet.push(0)
    this.sendPacket(packet)
  }

  private sendPacket(packet: number[]): void {
    const pcm = new Int16Array(packet.length)
    for (let index = 0; index < packet.length; index += 1) {
      pcm[index] = packet[index] < 0 ? packet[index] * 32768 : packet[index] * 32767
    }
    window.vocue.session.sendMicrophoneAudio(new Uint8Array(pcm.buffer))
  }

  private async releaseResources(): Promise<void> {
    this.stream?.getTracks().forEach((track) => track.stop())
    await this.context?.close()
    this.stream = null
    this.context = null
    this.resampler.reset()
  }
}

export const microphoneCapture = new MicrophoneCapture()
