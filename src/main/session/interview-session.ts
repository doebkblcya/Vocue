import { EventEmitter } from 'node:events'
import {
  createInitialInterviewSessionState,
  type AnswerLogEntry,
  type AudioMode,
  type InterviewSessionState,
} from '../../shared/types'
import { DeepSeekClient, type ChatMessage, type MessageContent } from '../ai/deepseek-client'
import {
  buildCurrentInterviewSystemPrompt,
  parseInterviewAnswer,
} from '../ai/prompt-builder'
import {
  type AsrUtteranceTiming,
  DoubaoAsr,
  PUSH_TO_TALK_PARAMS,
  SYSTEM_AUDIO_PARAMS,
} from '../asr/doubao-asr'
import { SystemAudioProcessor } from '../audio/system-audio-processor'
import { SystemAudioCapture } from '../audio/system-audio-capture'
import type { RecordingIssue } from '../../shared/recording-issue'
import { UNRECOGNIZED_SPEECH } from '../../shared/transcript'
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

/**
 * 对话历史的字符预算上限。
 *
 * 刻意不用「保留最近 N 轮」：回答在设计上就很短（一轮约 300~400 字符），
 * 一场长面试也就一两万字，真正的大头是 system prompt 里的简历和资料。
 * 而且历史是只追加的，服务端前缀缓存会把它整段吃掉，多留几乎不花钱。
 * 反过来，按轮数裁剪会改动消息数组开头，每轮都让缓存失效。
 * 所以这里只留一个宽松的安全网，正常面试根本不会触发。
 */
const HISTORY_CHAR_BUDGET = 60_000

/** 只统计文字长度：图片按 0 计，避免把 base64 算成几万字符 */
function contentLength(content: MessageContent): number {
  if (typeof content === 'string') return content.length
  return content.reduce((sum, part) => sum + (part.type === 'text' ? part.text.length : 0), 0)
}

export class InterviewSession extends EventEmitter<{
  state: [InterviewSessionState]
  'answer-log': [AnswerLogEntry[]]
}> {
  private state: InterviewSessionState = createInitialInterviewSessionState()
  private asr: DoubaoAsr | null = null
  /** 系统音频模式下，第二条相同的流式 ASR 专门记录候选人的麦克风。 */
  private candidateAsr: DoubaoAsr | null = null
  private deepseek: DeepSeekClient | null = null
  private systemAudio: SystemAudioCapture | null = null
  private systemAudioProcessor = new SystemAudioProcessor()
  private systemPrompt = ''
  /** 临时沿用 Bready 风格：最多保留 4 轮问题与 AI 建议回答。 */
  private history: ChatMessage[] = []
  /**
   * 已完成的问答，只给悬浮窗回看用。只增不减。
   *
   * 和 history 分开：history 会被 6 万字预算淘汰最旧的，而回看不该因为
   * 篇幅被裁掉；两者服务的目的不一样。
   */
  private answerLog: AnswerLogEntry[] = []
  private answerAbort: AbortController | null = null
  /** 每次收到新问题都会递增；旧回答的迟到流片段据此失效。 */
  private answerGeneration = 0
  /** 当前是否有一段录音正在进行（按下到松手之间） */
  private segmentActive = false
  /** ASR 尚未就绪时先把音频存在这里，连上后顺序补发 */
  private readonly pendingAudio: Buffer[] = []
  private safetyTimer: NodeJS.Timeout | null = null
  private readonly candidatePendingAudio: Buffer[] = []
  private activeRecordId: string | null = null
  private recordStartedAt = 0
  private recordIssue: RecordingIssue | null = null
  private stopping = false
  private interviewerFinishResolve: (() => void) | null = null
  private candidateFinishResolve: (() => void) | null = null

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
    this.answerLog = []
    this.emit('answer-log', [])
    this.systemAudioProcessor.reset()
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
      recordingTranscript: false,
      recordId: null,
    })

    if (mode === 'system') {
      // 系统音频必须连上才能开始，连不上就是开始失败
      try {
        this.asr = this.createAsr(config)
        this.candidateAsr = this.createCandidateAsr(config)
        await Promise.all([this.asr.connect(), this.candidateAsr.connect()])
        await this.startSystemAudio()
        const record = this.database.createInterviewSession({
          preparationId,
          preparationName: preparation?.name ?? '通用面试',
        })
        this.activeRecordId = record.id
        this.recordStartedAt = Date.now()
        this.recordIssue = null
        this.patchState({
          status: 'listening',
          recordingTranscript: true,
          recordId: record.id,
        })
      } catch (error) {
        await this.stopResources(false)
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

  /**
   * 记下第一个触发点就够了：后面的通常都是它的连锁反应
   * （候选人音频一积压，紧接着必然是一次重连），根因比罗列清单有用。
   */
  private markIncomplete(issue: RecordingIssue): void {
    this.recordIssue ??= issue
  }

  async stop(): Promise<void> {
    this.stopping = true
    await this.stopResources(true)
    if (this.activeRecordId) {
      this.database.finishInterviewSession(
        this.activeRecordId,
        this.recordIssue ? 'incomplete' : 'ready',
        this.recordIssue,
      )
    }
    this.activeRecordId = null
    this.recordStartedAt = 0
    this.recordIssue = null
    this.stopping = false
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
      recordingTranscript: false,
      recordId: null,
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
    if (this.state.mode === 'system' && this.activeRecordId) {
      const packet = Buffer.from(bytes)
      if (!this.candidateAsr?.isOpen()) {
        this.candidatePendingAudio.push(packet)
        // 16kHz / 16-bit / mono，每包约 100ms；最多保留最近 60 秒。
        if (this.candidatePendingAudio.length > 600) {
          this.candidatePendingAudio.shift()
          this.markIncomplete('candidate_backlog')
        }
        return
      }
      this.flushCandidatePending()
      this.candidateAsr.sendAudio(packet)
      return
    }
    if (this.state.mode !== 'microphone' || !this.segmentActive) return
    this.pendingAudio.push(Buffer.from(bytes))
    if (this.pendingAudio.length > 100) this.pendingAudio.shift()
    this.flushPending()
  }

  reportRecordingProblem(message: string): void {
    if (!this.activeRecordId || this.state.mode !== 'system') return
    this.markIncomplete('microphone_unavailable')
    this.patchState({ error: toUserMessage(message, '麦克风转写不可用，本次记录可能不完整') })
  }

  answerScreenshot(dataUrl: string, displayName: string): void {
    if (!this.deepseek || this.state.status === 'idle') throw new Error('请先开始一场面试')
    /*
     * 这一轮的请求里带着真实截图（见下面 userContent），但历史里只留这句占位符 ——
     * 图片不进历史，否则每一轮都要重发一张图。
     * 所以占位符必须说清「这里是一张图，内容你看不到」，
     * 而不是像在描述图片内容，否则模型会误以为自己知道截图里是什么。
     */
    const question = '[此处是一张候选人截取的屏幕截图，图片内容不在对话历史中]'
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
    let asr!: DoubaoAsr
    asr = new DoubaoAsr(config, {
      onPartial: (text) => {
        if (this.asr === asr) this.patchState({ partialTranscript: text })
      },
      onFinal: (text, timing) => {
        if (this.asr === asr) this.handleFinalTranscript(text, timing)
      },
      onSegmentEnd: (text, timing) => {
        if (this.asr === asr) {
          this.handleFinalTranscript(text, timing)
          this.interviewerFinishResolve?.()
          this.interviewerFinishResolve = null
        }
      },
      onUnrecognized: (timing) => {
        if (this.asr !== asr) return
        this.handleUnrecognized('interviewer', timing)
        this.interviewerFinishResolve?.()
        this.interviewerFinishResolve = null
      },
      onState: (state, message, code) => {
        // 已被刷新或替换的连接即使收到迟到错误，也不能污染当前会话状态。
        if (this.asr !== asr) return
        if (code === 45_000_081 && this.state.mode === 'microphone' && !this.segmentActive) {
          const idleAsr = this.asr
          this.asr = null
          idleAsr?.disconnect()
          if (this.state.status === 'reconnecting') this.patchState({ status: this.idleStatus(), error: '' })
          return
        }
        if (state === 'reconnecting') {
          if (this.state.mode === 'system') this.markIncomplete('asr_reconnecting')
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
            this.patchState({ status: this.segmentActive ? 'recording' : this.idleStatus(), error: '' })
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
    return asr
  }

  private createCandidateAsr(config: ReturnType<SettingsStore['get']>): DoubaoAsr {
    let asr!: DoubaoAsr
    asr = new DoubaoAsr(config, {
      onPartial: () => undefined,
      onFinal: (text, timing) => {
        if (this.candidateAsr === asr) this.recordUtterance('candidate', text, timing)
      },
      onSegmentEnd: (text, timing) => {
        if (this.candidateAsr !== asr) return
        this.recordUtterance('candidate', text, timing)
        this.candidateFinishResolve?.()
        this.candidateFinishResolve = null
      },
      onUnrecognized: (timing) => {
        if (this.candidateAsr !== asr) return
        this.handleUnrecognized('candidate', timing)
        this.candidateFinishResolve?.()
        this.candidateFinishResolve = null
      },
      onState: (state, message) => {
        if (this.candidateAsr !== asr) return
        if (state === 'connected') {
          this.flushCandidatePending()
          return
        }
        if (state === 'error') {
          this.markIncomplete('candidate_asr_error')
          this.patchState({ error: toUserMessage(message, '候选人语音转写出现问题') })
        }
      },
    }, {
      ...SYSTEM_AUDIO_PARAMS,
      enableDdc: false,
    })
    return asr
  }

  private flushCandidatePending(): void {
    if (!this.candidatePendingAudio.length || !this.candidateAsr?.isOpen()) return
    const pending = this.candidatePendingAudio.splice(0)
    for (const packet of pending) this.candidateAsr.sendAudio(packet)
  }

  private async startSystemAudio(): Promise<void> {
    const capture = new SystemAudioCapture()
    this.systemAudio = capture
    capture.on('data', (chunk) => {
      for (const packet of this.systemAudioProcessor.pushStereo24k(chunk)) this.asr?.sendAudio(packet)
    })
    capture.on('reconnecting', (attempt) => {
      this.patchState({ status: 'reconnecting', error: `系统音频正在第 ${attempt} 次重连` })
    })
    capture.on('error', (error) => {
      this.markIncomplete('system_audio_failed')
      this.patchState({ status: 'error', error: toUserMessage(error, '系统音频捕获失败，请重试') })
    })
    await capture.start()
  }

  private handleFinalTranscript(text: string, timing?: AsrUtteranceTiming): void {
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
    if (this.state.mode === 'system') this.recordUtterance('interviewer', normalized, timing)
    if (this.stopping) return
    this.patchState({ finalTranscript: normalized, partialTranscript: '' })
    this.requestAnswer(normalized)
  }

  /**
   * 服务端明确说完了一句，却没给出任何分句文本。
   *
   * 不猜内容、也不拿累计文本充数：如实留一条占位，位置和数量都保住。
   * 这里刻意不调 requestAnswer —— 没有题目可答，不该拿空气去问模型。
   */
  private handleUnrecognized(role: 'interviewer' | 'candidate', timing?: AsrUtteranceTiming): void {
    this.recordUtterance(role, UNRECOGNIZED_SPEECH, timing)
    // 面试官的缺口要实时告诉用户；候选人的只进记录，不打断悬浮窗
    if (role !== 'interviewer' || this.stopping) return
    this.patchState({ finalTranscript: UNRECOGNIZED_SPEECH, partialTranscript: '' })
  }

  /**
   * 面试官说了什么，就记什么。
   *
   * 这里原来还有一道「同一句话 5 秒内不记第二遍」的去重。删掉它是因为
   * 音频才是事实来源：服务端判停几次就是几句，不替它猜哪句是重复的。
   * 真出现重复，屏幕上能当场看见；被静默吃掉的那句，事后翻记录也找不回来。
   */
  private recordUtterance(
    role: 'interviewer' | 'candidate',
    text: string,
    timing?: AsrUtteranceTiming,
  ): void {
    const sessionId = this.activeRecordId
    const normalized = text.trim()
    if (!sessionId || !normalized) return
    const fallbackEnd = Math.max(0, Date.now() - this.recordStartedAt)
    const endMs = timing?.endMs ?? fallbackEnd
    const startMs = timing?.startMs ?? Math.max(0, endMs - Math.max(600, normalized.length * 120))
    this.database.appendInterviewUtterance({ sessionId, role, text: normalized, startMs, endMs })
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
      ...this.history,
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
      this.trimHistory()
      const parsed = parseInterviewAnswer(completed)
      this.answerLog.push({
        question,
        answer: completed,
        summary: parsed.summary,
        detail: parsed.detail,
      })
      this.patchState({
        answer: completed,
        answerSummary: parsed.summary,
        answerDetail: parsed.detail,
      })
      // 只在一条回答真正完成时才发，不跟着流式的每一小段发
      this.emit('answer-log', [...this.answerLog])
    } finally {
      // 旧请求的 finally 不能覆盖新请求的生成状态。
      if (generation === this.answerGeneration) {
        this.answerAbort = null
        this.patchState({ generating: false })
      }
    }
  }

  /**
   * 只在历史超过字符预算时，从最早的一轮开始整对丢弃。
   * 必须成对丢（问题 + 回答），否则 role 交替会被破坏，模型会看到连续两条 user。
   */
  private trimHistory(): void {
    let total = this.history.reduce((sum, message) => sum + contentLength(message.content), 0)
    while (total > HISTORY_CHAR_BUDGET && this.history.length > 2) {
      const [question, answer] = this.history
      total -= contentLength(question.content) + contentLength(answer.content)
      this.history.splice(0, 2)
    }
  }

  private async stopResources(finalizeTranscript: boolean): Promise<void> {
    this.answerGeneration += 1
    this.answerAbort?.abort()
    this.answerAbort = null
    this.clearSafetyFallback()
    this.segmentActive = false
    this.pendingAudio.length = 0
    this.systemAudio?.stop()
    this.systemAudio = null
    if (finalizeTranscript && this.state.mode === 'system') {
      this.flushCandidatePending()
      const finished = await Promise.all([
        this.finishAsr(this.asr, 'interviewer'),
        this.finishAsr(this.candidateAsr, 'candidate'),
      ])
      if (finished.some((value) => !value)) this.markIncomplete('transcript_finalize_failed')
    }
    this.asr?.disconnect()
    this.asr = null
    this.candidateAsr?.disconnect()
    this.candidateAsr = null
    this.candidatePendingAudio.length = 0
    this.interviewerFinishResolve = null
    this.candidateFinishResolve = null
    this.deepseek = null
    this.systemAudioProcessor.reset()
  }

  private finishAsr(
    asr: DoubaoAsr | null,
    role: 'interviewer' | 'candidate',
  ): Promise<boolean> {
    if (!asr?.isOpen()) return Promise.resolve(false)
    return new Promise<boolean>((resolve) => {
      let done = false
      const finish = (completed = true): void => {
        if (done) return
        done = true
        clearTimeout(timeout)
        resolve(completed)
      }
      const timeout = setTimeout(() => finish(false), 3000)
      if (role === 'interviewer') this.interviewerFinishResolve = finish
      else this.candidateFinishResolve = finish
      asr.finishSegment()
    })
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
