class MicrophoneCapture {
  private context: AudioContext | null = null
  private stream: MediaStream | null = null
  private sending = false
  private ready = false
  private samples: number[] = []
  /** 串行化按下/松开，避免首次授权期间重复初始化或松开事件越过按下事件。 */
  private transition: Promise<void> = Promise.resolve()

  setSending(active: boolean): Promise<void> {
    const operation = this.transition.then(() => this.applySending(active))
    // 一次失败不能让后续所有按键操作都卡在 rejected promise 上。
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
      try {
        await window.vocue.session.setMicrophoneActive(true)
        this.ready = true
        this.sendCompletePackets()
      } catch (error) {
        this.sending = false
        this.ready = false
        this.samples = []
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

  stop(): void {
    this.transition = this.transition
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
        this.ready = false
        this.stream?.getTracks().forEach((track) => track.stop())
        await this.context?.close()
        this.stream = null
        this.context = null
        this.samples = []
      })
  }

  private async initialize(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: true,
        autoGainControl: true,
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
      if (this.sending) this.process(event.data, this.context?.sampleRate ?? 48_000)
    }
    source.connect(worklet)
    worklet.connect(silent).connect(this.context.destination)
  }

  private process(input: Float32Array, inputRate: number): void {
    const ratio = inputRate / 16_000
    const outputLength = Math.floor(input.length / ratio)
    for (let index = 0; index < outputLength; index += 1) {
      const position = index * ratio
      const before = Math.floor(position)
      const after = Math.min(before + 1, input.length - 1)
      const fraction = position - before
      const value = input[before] + (input[after] - input[before]) * fraction
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
}

export const microphoneCapture = new MicrophoneCapture()
