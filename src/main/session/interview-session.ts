import { EventEmitter } from 'node:events'
import {
  createInitialInterviewSessionState,
  type AudioMode,
  type InterviewSessionState,
} from '../../shared/types'
import { DeepSeekClient, type ChatMessage, type MessageContent } from '../ai/deepseek-client'
import {
  buildCurrentInterviewSystemPrompt,
  parseInterviewAnswer,
} from '../ai/prompt-builder'
import {
  DoubaoAsr,
  PUSH_TO_TALK_PARAMS,
  SYSTEM_AUDIO_PARAMS,
} from '../asr/doubao-asr'
import { PcmAudioProcessor } from '../audio/audio-processor'
import { SystemAudioCapture } from '../audio/system-audio-capture'
import { log } from '../log'
import { LocalDatabase } from '../storage/database'
import { SettingsStore } from '../storage/settings'
import { toUserMessage } from '../../shared/error-message'

/**
 * 服务端没有回最后一包时的安全网。
 * 正常路径由服务端 is_last_package 触发结算，这个超时只是兜底，
 * 不参与「说完了」的判定，所以给得足够长，避免出现半截稿抢先回答。
 */
const SEGMENT_SAFETY_TIMEOUT_MS = 8000

export class InterviewSession extends EventEmitter<{ state: [InterviewSessionState] }> {
  private state: InterviewSessionState = createInitialInterviewSessionState()
  private asr: DoubaoAsr | null = null
  private deepseek: DeepSeekClient | null = null
  private systemAudio: SystemAudioCapture | null = null
  private processor = new PcmAudioProcessor()
  private systemPrompt = ''
  /** 临时沿用 Bready 风格：最多保留 4 轮问题与 AI 建议回答。 */
  private history: ChatMessage[] = []
  private answerAbort: AbortController | null = null
  /** 每次收到新问题都会递增；旧回答的迟到流片段据此失效。 */
  private answerGeneration = 0
  /** 当前是否有一段录音正在进行（按下到松手之间） */
  private segmentActive = false
  /** ASR 尚未就绪时先把音频存在这里，连上后顺序补发 */
  private readonly pendingAudio: Buffer[] = []
  private safetyTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly database: LocalDatabase,
    private readonly settings: SettingsStore,
  ) {
    super()
  }

  getState(): InterviewSessionState {
    return { ...this.state }
  }

  async start(preparationId: string | null, mode: AudioMode): Promise<void> {
    await this.stop()
    const preparation = preparationId ? this.database.getPreparation(preparationId) : null
    if (preparationId && !preparation) throw new Error('面试档案不存在')
    if (!this.settings.isReady()) throw new Error('请先完成 API 配置')

    const config = this.settings.get()
    this.systemPrompt = buildCurrentInterviewSystemPrompt(preparation)
    this.deepseek = new DeepSeekClient(config)
    this.history = []
    this.processor.reset()
    this.patchState({
      status: 'connecting',
      mode,
      preparationId,
      preparationName: preparation?.name ?? '通用面试',
      partialTranscript: '',
      finalTranscript: '',
      answer: '',
      answerSummary: '',
      answerDetail: '',
      error: '',
      microphoneActive: false,
      generating: false,
    })

    if (mode === 'system') {
      // 系统音频必须连上才能开始，连不上就是开始失败
      try {
        this.asr = this.createAsr(config)
        await this.asr.connect()
        await this.startSystemAudio()
        this.patchState({ status: 'listening' })
      } catch (error) {
        await this.stopResources()
        this.patchState({
          status: 'error',
          error: toUserMessage(error, '开始面试失败，请重试'),
        })
        throw error
      }
      return
    }

    // 麦克风模式：开始面试时就先建一次连接做检测。
    // 端点、凭证、资源 ID 是否匹配当场就知道，不必等你按下按钮才翻车；
    // 这条连接顺便给第一次按下复用。
    this.patchState({ status: 'verifying' })
    try {
      this.asr = this.createAsr(config)
      await this.asr.connect()
      this.patchState({ status: 'ready', error: '' })
    } catch (error) {
      // 检测失败不算开始失败：面试照常进行，错误先摆出来，
      // 你按下按钮时会再试一次，避免一次网络抖动就进不了面试。
      this.patchState({
        status: 'error',
        error: toUserMessage(error, '语音识别服务检测失败，按下录音时会再试一次'),
      })
    }
  }

  /**
   * 手动重新检测语音识别服务（界面上的刷新按钮）。
   * 只做一次建连握手，不重启会话、不打断正在生成的回答。
   */
  async verifyService(): Promise<void> {
    if (this.state.mode !== 'microphone' || this.state.status === 'idle') return
    if (this.state.status === 'verifying') return
    if (this.segmentActive) return
    // 正在等上一段的识别结果时，不打断它
    if (this.state.status === 'finalizing' || this.state.generating) return

    // 先摘掉引用再断开：旧连接后续的任何回调都不该再改状态
    const previous = this.asr
    this.asr = null
    previous?.disconnect()

    // 一次广播里同时「清掉旧错误」和「进入检测中」，中间不存在其他状态
    this.patchState({ status: 'verifying', error: '' })
    try {
      const asr = this.createAsr(this.settings.get())
      this.asr = asr
      await asr.connect()
      this.patchState({ status: 'ready', error: '' })
    } catch (error) {
      this.asr = null
      this.patchState({
        status: 'error',
        error: toUserMessage(error, '语音识别服务检测失败，按下录音时会再试一次'),
      })
    }
  }

  async stop(): Promise<void> {
    await this.stopResources()
    this.patchState({
      status: 'idle',
      mode: null,
      preparationId: null,
      preparationName: '',
      partialTranscript: '',
      finalTranscript: '',
      answer: '',
      answerSummary: '',
      answerDetail: '',
      microphoneActive: false,
      generating: false,
      error: '',
    })
  }

  async reconnect(): Promise<void> {
    const { preparationId, mode } = this.state
    if (!mode) throw new Error('当前没有正在运行的面试')
    await this.start(preparationId, mode)
  }

  async setMicrophoneActive(active: boolean): Promise<void> {
    if (this.state.mode !== 'microphone' || this.state.status === 'idle') return

    if (!active) {
      if (!this.segmentActive) return
      this.segmentActive = false
      this.flushPending()
      // 官方规范：发「最后一包」（负包），服务端收到后立即回最终结果。
      // 结算交给 onSegmentEnd，本地只留一个很长的安全网。
      this.asr?.finishSegment()
      this.patchState({ microphoneActive: false, status: 'finalizing' })
      this.armSafetyFallback()
      return
    }

    this.segmentActive = true
    this.patchState({ microphoneActive: true, status: 'recording', error: '' })
    try {
      // 采集与建连并行：音频先进缓冲，连上后回补，避免建连期间丢字
      if (!this.asr?.isOpen()) {
        this.asr?.disconnect()
        this.asr = this.createAsr(this.settings.get())
        await this.asr.connect()
      }
      this.flushPending()
    } catch (error) {
      this.asr = null
      this.segmentActive = false
      this.pendingAudio.length = 0
      const message = toUserMessage(error, '语音识别连接失败，请重试')
      this.patchState({ microphoneActive: false, status: 'error', error: message })
      throw error
    }
  }

  sendMicrophoneAudio(bytes: Uint8Array): void {
    if (this.state.mode !== 'microphone' || !this.segmentActive) return
    this.pendingAudio.push(Buffer.from(bytes))
    if (this.pendingAudio.length > 100) this.pendingAudio.shift()
    this.flushPending()
  }

  answerScreenshot(dataUrl: string, displayName: string): void {
    if (!this.deepseek || this.state.status === 'idle') throw new Error('请先开始一场面试')
    const question = '屏幕截图中的题目或代码'
    const text = [
      `请分析来自“${displayName}”的屏幕截图。`,
      '优先识别其中正在提问的面试题、代码、报错或图表,然后直接给出候选人可以使用的回答。',
      '如果截图中没有明确题目,请概括最可能需要解释的核心内容,不要描述无关界面。',
    ].join('\n')
    this.patchState({ finalTranscript: '屏幕截图提问', partialTranscript: '' })
    this.requestAnswer(question, [
      { type: 'text', text },
      { type: 'image_url', image_url: { url: dataUrl, detail: 'original' } },
    ])
  }

  /** ASR 就绪后把积压的音频按顺序补发 */
  private flushPending(): void {
    if (!this.pendingAudio.length || !this.asr?.isOpen()) return
    const pending = this.pendingAudio.splice(0)
    for (const packet of pending) this.asr.sendAudio(packet)
  }

  /** 只为「服务端彻底没反应」准备的长超时，不参与正常路径 */
  private armSafetyFallback(): void {
    this.clearSafetyFallback()
    this.safetyTimer = setTimeout(() => {
      this.safetyTimer = null
      if (this.state.status !== 'finalizing') return
      const text = this.state.partialTranscript.trim()
      if (text) this.handleFinalTranscript(text)
      else this.patchState({ status: this.idleStatus(), partialTranscript: '' })
    }, SEGMENT_SAFETY_TIMEOUT_MS)
  }

  private clearSafetyFallback(): void {
    if (this.safetyTimer) clearTimeout(this.safetyTimer)
    this.safetyTimer = null
  }

  private createAsr(config: ReturnType<SettingsStore['get']>): DoubaoAsr {
    // 判停方式按模式二选一：
    // 按住说话靠「最后一包」，系统音频靠服务端 VAD 判停
    const params = this.state.mode === 'system' ? SYSTEM_AUDIO_PARAMS : PUSH_TO_TALK_PARAMS
    return new DoubaoAsr(config, {
      onPartial: (text) => this.patchState({ partialTranscript: text }),
      onFinal: (text) => this.handleFinalTranscript(text),
      onSegmentEnd: (text) => this.handleFinalTranscript(text),
      onState: (state, message, code) => {
        if (code === 45_000_081 && this.state.mode === 'microphone' && !this.segmentActive) {
          const idleAsr = this.asr
          this.asr = null
          idleAsr?.disconnect()
          if (this.state.status === 'reconnecting') this.patchState({ status: this.idleStatus(), error: '' })
          return
        }
        if (state === 'reconnecting') {
          if (this.segmentActive) {
            // 录音中掉线：立刻退出录音态，避免「显示在录音、实际没在识别」
            this.segmentActive = false
            this.pendingAudio.length = 0
            this.clearSafetyFallback()
            this.patchState({
              status: 'reconnecting',
              microphoneActive: false,
              error: '语音识别已断开，刚才这段没有识别，请重说',
            })
            return
          }
          this.patchState({ status: 'reconnecting', error: message ?? '' })
          return
        }
        if (state === 'connected') {
          if (this.state.status === 'reconnecting' || this.state.status === 'verifying') {
            this.patchState({ status: this.segmentActive ? 'recording' : 'ready', error: '' })
          }
          return
        }
        if (state === 'idle') {
          // 主动释放空闲连接：保持「已验证」的状态，不报错
          if (this.state.mode === 'microphone' && !this.segmentActive) {
            this.patchState({ status: 'ready', error: '' })
          }
          return
        }
        if (state === 'error') {
          this.patchState({
            status: 'error',
            error: toUserMessage(message, '语音识别出现问题，请重试'),
          })
        }
      },
    }, params)
  }

  private async startSystemAudio(): Promise<void> {
    const capture = new SystemAudioCapture()
    this.systemAudio = capture
    capture.on('data', (chunk) => {
      for (const packet of this.processor.pushStereo48k(chunk)) this.asr?.sendAudio(packet)
    })
    capture.on('reconnecting', (attempt) => {
      this.patchState({ status: 'reconnecting', error: `系统音频正在第 ${attempt} 次重连` })
    })
    capture.on('error', (error) =>
      this.patchState({ status: 'error', error: toUserMessage(error, '系统音频捕获失败，请重试') }),
    )
    await capture.start()
  }

  private handleFinalTranscript(text: string): void {
    // 服务端最后一包或本地安全网结算：先收掉兜底计时，避免重复结算
    this.clearSafetyFallback()
    // 麦克风模式：这一段结束了，连接不需要留着（空闲时服务端也会掐）。
    // 下次按下会重新建连，所以这里释放掉，避免出现「没按按钮却在重连」。
    if (this.state.mode === 'microphone') this.asr?.markIdle()
    const normalized = text.trim()
    if (!normalized) {
      if (this.state.status === 'finalizing') this.patchState({ status: this.idleStatus(), partialTranscript: '' })
      return
    }
    this.patchState({ finalTranscript: normalized, partialTranscript: '' })
    this.requestAnswer(normalized)
  }

  private requestAnswer(question: string, userContent?: MessageContent): void {
    const generation = ++this.answerGeneration
    // 实时面试只保留最新问题。新问题到来时中止旧回答，避免答案与转写错位。
    this.answerAbort?.abort()
    void this.answerQuestion(question, generation, userContent ?? question)
      .catch((error: unknown) => {
        if ((error as Error)?.name !== 'AbortError') {
          const message = toUserMessage(error, '生成回答失败，请重试')
          if (generation === this.answerGeneration) {
            this.patchState({ status: 'error', error: message })
          }
          log.error('生成面试回答失败', error)
        }
      })
  }

  private async answerQuestion(
    question: string,
    generation: number,
    userContent: MessageContent,
  ): Promise<void> {
    if (!this.deepseek) return
    const controller = new AbortController()
    this.answerAbort = controller
    // 生成属于模型侧状态，不写进语音服务状态
    this.patchState({
      generating: true,
      answer: '',
      answerSummary: '',
      answerDetail: '',
      error: '',
    })
    const messages: ChatMessage[] = [
      { role: 'system', content: this.systemPrompt },
      ...this.history.slice(-8),
      {
        role: 'user',
        content: userContent,
      },
    ]
    try {
      let answer = ''
      const completed = await this.deepseek.stream(
        messages,
        (delta) => {
          if (generation !== this.answerGeneration) return
          answer += delta
          const parsed = parseInterviewAnswer(answer)
          this.patchState({
            answer,
            answerSummary: parsed.summary,
            answerDetail: parsed.detail,
          })
        },
        controller.signal,
      )
      if (generation !== this.answerGeneration) return
      this.history.push(
        { role: 'user', content: question },
        { role: 'assistant', content: completed },
      )
      this.history = this.history.slice(-8)
      const parsed = parseInterviewAnswer(completed)
      this.patchState({
        answer: completed,
        answerSummary: parsed.summary,
        answerDetail: parsed.detail,
      })
    } finally {
      // 旧请求的 finally 不能覆盖新请求的生成状态。
      if (generation === this.answerGeneration) {
        this.answerAbort = null
        this.patchState({ generating: false })
      }
    }
  }

  private async stopResources(): Promise<void> {
    this.answerGeneration += 1
    this.answerAbort?.abort()
    this.answerAbort = null
    this.clearSafetyFallback()
    this.segmentActive = false
    this.pendingAudio.length = 0
    this.systemAudio?.stop()
    this.systemAudio = null
    this.asr?.disconnect()
    this.asr = null
    this.deepseek = null
    this.processor.reset()
  }

  /**
   * 空闲状态：
   * 系统音频模式是「正在聆听」（确实在持续采音）；
   * 麦克风模式是「服务正常」（已通过建连验证，等你按下按钮）。
   */
  private idleStatus(): 'listening' | 'ready' {
    return this.state.mode === 'microphone' ? 'ready' : 'listening'
  }

  private patchState(patch: Partial<InterviewSessionState>): void {
    this.state = { ...this.state, ...patch }
    this.emit('state', this.getState())
  }
}
