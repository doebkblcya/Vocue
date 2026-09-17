import { randomUUID } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import WebSocket, { type RawData } from 'ws'
import type { AppSettings } from '../../shared/types'
import { log } from '../log'

const MESSAGE_FULL_CLIENT_REQUEST = 0x1
const MESSAGE_AUDIO_ONLY_REQUEST = 0x2
const MESSAGE_FULL_SERVER_RESPONSE = 0x9
const MESSAGE_SERVER_ACK = 0xb
const MESSAGE_ERROR = 0xf
/** 0b0001：header 后 4 字节为正序号 */
const FLAGS_POSITIVE_SEQUENCE = 0x1
/** 0b0011：header 后 4 字节为负序号，同时表示这是最后一包（负包） */
const FLAGS_NEGATIVE_SEQUENCE = 0x3
/** 服务端响应里 flags 的 0x02 位表示「这是最后一个响应包」 */
const FLAGS_LAST_PACKAGE = 0x2
/**
 * 双向流式优化版。官方 demo（Python/Go）与社区实现均使用该端点；
 * 旧版双向流式端点是 .../sauc/bigmodel，不支持 enable_nonstream 二遍识别。
 */
const DOUBAO_ASR_ENDPOINT = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async'
const DOUBAO_ASR_RESOURCE_ID = 'volc.seedasr.sauc.duration'
/** 配置包占用的序号，音频包从 2 开始递增，与官方 demo 一致 */
const FULL_CLIENT_REQUEST_SEQ = 1

interface AsrResponse {
  code?: number
  message?: string
  result?: {
    text?: string
    utterances?: Array<{ text?: string; definite?: boolean }>
  }
  text?: string
  is_final?: boolean
  final?: boolean
  definite?: boolean
}

/**
 * 两种模式对判停的需求是相反的：
 *
 * - microphone（按住说话）：判停由客户端松手时发的「最后一包」触发。
 *   必须关掉 VAD 分句，否则说话中途停顿就会被切成多段。
 *
 * - system（系统音频）：音频是持续流，没有「松手」这个信号，
 *   只能由服务端按静音判停。必须配好 VAD 参数，否则拿不到 definite。
 */
export interface DoubaoAsrParams {
  /** 二遍识别：开启后才会由非流式结果输出 definite，官方为连续识别场景设计 */
  enableNonstream: boolean
  /** 强制判停的静音阈值（ms）。仅在系统音频模式下有意义 */
  endWindowSize?: number
  /** 音频开头强制按有声处理（ms），避免开头静音导致判不出句子 */
  forceToSpeechTime?: number
}

export const PUSH_TO_TALK_PARAMS: DoubaoAsrParams = {
  enableNonstream: false,
}

export const SYSTEM_AUDIO_PARAMS: DoubaoAsrParams = {
  enableNonstream: true,
  // 官方推荐区间 800~1000，这里取更保守的值：
  // 面试官常常边想边说，宁可多等一点，也不要一句话被切两半。
  endWindowSize: 1200,
  forceToSpeechTime: 1000,
}

export interface DoubaoAsrCallbacks {
  onPartial: (text: string) => void
  onFinal: (text: string) => void
  /** 服务端返回最后一包（is_last_package），表示这一段音频已经识别完毕 */
  onSegmentEnd: (text: string) => void
  onState: (
    state: 'connected' | 'reconnecting' | 'error' | 'idle',
    message?: string,
    code?: number,
  ) => void
}

/**
 * definite 到达后再等一小会儿才取用。
 * 服务端有时会把同一段连续判停成一串 definite，等文本落定再提问，
 * 避免拿半句话去生成回答（做法与成熟实现一致）。
 */
const SEGMENT_SETTLE_MS = 1000

export class DoubaoAsr {
  private socket: WebSocket | null = null
  private desiredConnected = false
  private reconnectAttempts = 0
  private reconnectTimer: NodeJS.Timeout | null = null
  private latestText = ''
  private lastFinal = ''
  private lastFinalAt = 0
  /** 当前这一段的包序号，配置包占 1，音频包从 2 起递增 */
  private sequence = FULL_CLIENT_REQUEST_SEQ
  /** 是否已经发出过最后一包，避免重复发送 */
  private finished = false
  /**
   * 麦克风模式：空闲（没在录音）时不需要保持连接。
   * 设为 true 后，连接断开或被释放都不再重连，
   * 避免「你没按按钮却在反复重连」。
   */
  private idleDispose = false
  /** definite 之后等文本落定的计时器 */
  private settleTimer: NodeJS.Timeout | null = null
  /** 最近一条 definite 分句的文本：它是服务端锁定的结果，优先于中间稿 */
  private definiteText = ''
  /**
   * 连接代际。每开一条新连接自增，回调里带上自己那一代，
   * 用来丢弃旧连接迟到的帧——避免「快速连按时上一段的文本串进当前这段」。
   */
  private generation = 0

  constructor(
    private readonly settings: AppSettings,
    private readonly callbacks: DoubaoAsrCallbacks,
    /** 由调用方按模式选择：按住说话 / 系统音频 */
    private readonly params: DoubaoAsrParams = PUSH_TO_TALK_PARAMS,
  ) {}

  async connect(): Promise<void> {
    this.validateCredentials()
    this.desiredConnected = true
    this.reconnectAttempts = 0
    await this.openSocket()
  }

  /**
   * 标记为「空闲」：麦克风模式没在录音、也没有待结算的段时调用。
   * 此时连接对我们没有价值（真需要的时候按下按钮会重新建连），
   * 所以断开并且不再重连，同时把收尾计时清掉。
   */
  markIdle(): void {
    this.idleDispose = true
    this.desiredConnected = false
    this.generation += 1
    const socket = this.socket
    this.socket = null
    if (socket?.readyState === WebSocket.OPEN) socket.close(1000)
    else socket?.terminate()
    // 告诉上层这是「主动释放」，不是故障：不要显示错误，也不需要重连
    this.callbacks.onState('idle')
  }

  disconnect(): void {
    this.desiredConnected = false
    this.generation += 1
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    const socket = this.socket
    this.socket = null
    // 断开连接不是一次录音结算。发送空的「最后一包」会让服务端返回
    // 45000002（空音频），并可能在新连接建立后以迟到错误污染界面。
    if (socket?.readyState === WebSocket.OPEN) socket.close(1000)
    else socket?.terminate()
  }

  isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  sendAudio(pcm16Mono16k: Buffer | Uint8Array): void {
    if (this.socket?.readyState !== WebSocket.OPEN || this.finished) return
    const payload = gzipSync(Buffer.from(pcm16Mono16k))
    this.sequence += 1
    this.socket.send(
      buildFrame(MESSAGE_AUDIO_ONLY_REQUEST, FLAGS_POSITIVE_SEQUENCE, 0, 1, payload, this.sequence),
    )
  }

  /**
   * 发出「最后一包」（负包）。
   * 官方规范：audio only request + flags 0b0011 + 序号取负，
   * 服务端收到后立即回最终结果，客户端以 is_last_package 判定该段结束。
   */
  finishSegment(tailPcm16Mono16k?: Buffer | Uint8Array): void {
    if (this.finished) return
    const socket = this.socket
    if (socket?.readyState !== WebSocket.OPEN) return
    this.finished = true
    this.sequence += 1
    const payload = gzipSync(
      tailPcm16Mono16k?.byteLength ? Buffer.from(tailPcm16Mono16k) : Buffer.alloc(0),
    )
    socket.send(
      buildFrame(
        MESSAGE_AUDIO_ONLY_REQUEST,
        FLAGS_NEGATIVE_SEQUENCE,
        0,
        1,
        payload,
        -this.sequence,
      ),
    )
  }

  private validateCredentials(): void {
    if (!this.settings.doubaoApiKey) throw new Error('尚未配置豆包新版 API Key')
  }

  private async openSocket(): Promise<void> {
    if (!this.desiredConnected) return
    this.socket?.terminate()
    this.resetSegment()

    const connectId = randomUUID()
    const headers: Record<string, string> = {
      'X-Api-Key': this.settings.doubaoApiKey,
      'X-Api-Resource-Id': DOUBAO_ASR_RESOURCE_ID,
      'X-Api-Connect-Id': connectId,
      'X-Api-Request-Id': connectId,
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false
      const socket = new WebSocket(DOUBAO_ASR_ENDPOINT, { headers })
      this.socket = socket
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true
          socket.terminate()
          reject(new Error('连接豆包语音识别超时'))
        }
      }, 10_000)

      socket.once('open', () => {
        const request = this.buildRequest()
        socket.send(
          buildFrame(
            MESSAGE_FULL_CLIENT_REQUEST,
            FLAGS_POSITIVE_SEQUENCE,
            1,
            1,
            gzipSync(Buffer.from(JSON.stringify(request))),
            FULL_CLIENT_REQUEST_SEQ,
          ),
        )
        clearTimeout(timeout)
        settled = true
        this.reconnectAttempts = 0
        this.callbacks.onState('connected')
        resolve()
      })

      const generation = this.generation
      socket.on('message', (data) => this.handleMessage(data, generation))
      socket.on('error', (error) => {
        log.error('豆包 ASR WebSocket 错误', error)
        if (!settled) {
          clearTimeout(timeout)
          settled = true
          reject(error)
        }
      })
      socket.on('close', (code) => {
        clearTimeout(timeout)
        if (this.socket === socket) this.socket = null
        if (!settled) {
          settled = true
          reject(new Error(`豆包语音连接关闭 (${code})`))
        }
        if (this.desiredConnected) this.scheduleReconnect()
      })
    })
  }

  /**
   * 按模式组装请求参数。
   *
   * 公共部分：官方文档的请求字段 + 官方 demo 的取值。
   * 差异部分：判停方式。
   *   - 按住说话：不配 VAD 参数，判停完全交给「最后一包」。
   *   - 系统音频：配 VAD 参数，由服务端按静音判停并输出 definite。
   *     若同时配了 end_window_size，官方文档说明语义分句失效、改按静音时长分句。
   */
  private buildRequest(): Record<string, unknown> {
    const request: Record<string, unknown> = {
      model_name: 'bigmodel',
      enable_itn: true,
      enable_punc: true,
      enable_ddc: true,
      show_utterances: true,
      // 用官方默认的 full（全量返回）而不是 single（增量）：
      // 增量返回的终稿可能只是最后一片，会把回答截短。
      result_type: 'full',
      ssd_version: '200',
      enable_nonstream: this.params.enableNonstream,
    }
    if (this.params.endWindowSize !== undefined) {
      request.end_window_size = this.params.endWindowSize
    }
    if (this.params.forceToSpeechTime !== undefined) {
      request.force_to_speech_time = this.params.forceToSpeechTime
    }
    return {
      user: { uid: 'vocue' },
      audio: { format: 'pcm', rate: 16_000, bits: 16, channel: 1 },
      request,
    }
  }

  private handleMessage(raw: RawData, generation: number): void {
    // 旧连接迟到的帧直接丢弃，别污染当前这一段
    if (generation !== this.generation) return
    try {
      const response = parseFrame(Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer))
      if (response.type === MESSAGE_ERROR) {
        const message = response.body?.message || `豆包语音识别错误 (${response.errorCode ?? 'unknown'})`
        log.error('豆包 ASR 服务端错误', `${response.errorCode ?? 'unknown'}: ${message}`)
        if (isRetriableServerError(response.errorCode)) {
          this.callbacks.onState('reconnecting', message, response.errorCode)
          this.socket?.close(1012, 'retryable server error')
          return
        }
        this.callbacks.onState('error', message, response.errorCode)
        return
      }
      if (response.type === MESSAGE_SERVER_ACK) {
        const code = response.body?.code
        if (code && code !== 1000 && code !== 20_000_000) {
          this.callbacks.onState('error', response.body?.message || `豆包返回错误 ${code}`)
        }
        return
      }
      if (response.type !== MESSAGE_FULL_SERVER_RESPONSE || !response.body) return

      const utterances = response.body.result?.utterances ?? []
      const lastUtterance = utterances.at(-1)
      // 优先取「最后一个分句」的文本，而不是 result.text。
      // result.text 是整条连接的累计文本：系统音频是长连接，
      // 用它会把这十几分钟说过的话全部当成一个问题送进模型。
      // 按住说话一段一条连接，两者等价；分句缺失时才退回累计文本。
      const text = (lastUtterance?.text || response.body.result?.text || response.body.text || '').trim()
      // 服务端最后一包：这一段识别完毕，即使文本为空也要结算，否则会话会一直停在收尾态
      if (response.isLastPackage) {
        this.callbacks.onSegmentEnd(text || this.latestText)
        this.latestText = ''
        return
      }
      if (!text) return
      this.latestText = text
      const final = Boolean(
        lastUtterance?.definite ||
          response.body.is_final ||
          response.body.final ||
          response.body.definite,
      )
      if (final) this.finalize(text)
      else this.callbacks.onPartial(text)
    } catch (error) {
      log.error('解析豆包 ASR 消息失败', error)
    }
  }

  /** 重置当前段落的序号、文本与落定计时（每次新连接都会调） */
  private resetSegment(): void {
    if (this.settleTimer) clearTimeout(this.settleTimer)
    this.settleTimer = null
    this.definiteText = ''
    this.generation += 1
    this.sequence = FULL_CLIENT_REQUEST_SEQ
    this.finished = false
    this.latestText = ''
  }

  /**
   * 服务端判停（definite）后调用。
   *
   * 不立刻取用，而是把文本存入 definiteText 并重置一个短计时器：
   * 服务端有时会把同一段连续判停成一串 definite，
   * 等它落定再提问，避免拿半句话去生成回答。
   * definiteText 是服务端锁定的分句结果，优先于中间稿 latestText。
   */
  private finalize(text: string): void {
    const normalized = text.trim()
    if (normalized) this.definiteText = normalized
    if (this.settleTimer) clearTimeout(this.settleTimer)
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null
      const settled = (this.definiteText || this.latestText).trim()
      this.definiteText = ''
      if (!settled) return
      const now = Date.now()
      if (settled === this.lastFinal && now - this.lastFinalAt < 5000) return
      this.lastFinal = settled
      this.lastFinalAt = now
      this.latestText = ''
      this.callbacks.onFinal(settled)
    }, SEGMENT_SETTLE_MS)
  }

  private scheduleReconnect(): void {
    // 空闲释放（麦克风模式没在录音）时不重连：没有音频要发，重连毫无意义
    if (this.idleDispose) return
    if (!this.desiredConnected || this.reconnectTimer) return
    if (this.reconnectAttempts >= 5) {
      this.callbacks.onState('error', '豆包语音识别连续重连失败，请检查网络和凭证')
      return
    }
    this.reconnectAttempts += 1
    this.callbacks.onState('reconnecting', `正在第 ${this.reconnectAttempts} 次重连`)
    const delay = Math.min(1000 * 2 ** (this.reconnectAttempts - 1), 10_000)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.openSocket().catch(() => this.scheduleReconnect())
    }, delay)
  }
}

export function isRetriableServerError(code: number | undefined): boolean {
  return code !== undefined && code >= 55_000_000 && code < 56_000_000
}

export function buildFrame(
  messageType: number,
  flags: number,
  serialization: number,
  compression: number,
  payload: Buffer,
  sequence?: number,
): Buffer {
  const hasSequence = flags === FLAGS_POSITIVE_SEQUENCE || flags === FLAGS_NEGATIVE_SEQUENCE
  const header = Buffer.alloc(hasSequence ? 12 : 8)
  header[0] = (0x1 << 4) | 0x1
  header[1] = (messageType << 4) | flags
  header[2] = (serialization << 4) | compression
  header[3] = 0
  let offset = 4
  if (hasSequence) {
    header.writeInt32BE(sequence ?? 0, offset)
    offset += 4
  }
  header.writeUInt32BE(payload.length, offset)
  return Buffer.concat([header, payload])
}

export function parseFrame(buffer: Buffer): {
  type: number
  errorCode?: number
  isLastPackage: boolean
  body?: AsrResponse
} {
  if (buffer.length < 4) throw new Error('ASR 响应长度不足')
  const headerSize = (buffer[0] & 0x0f) * 4
  const type = buffer[1] >> 4
  const flags = buffer[1] & 0x0f
  const serialization = buffer[2] >> 4
  const compression = buffer[2] & 0x0f
  // flags 的 0x02 位表示「这是最后一个响应包」——客户端据此判定一段结束
  const isLastPackage = (flags & FLAGS_LAST_PACKAGE) !== 0
  let offset = headerSize
  let errorCode: number | undefined

  if (type === MESSAGE_ERROR && buffer.length >= offset + 4) {
    errorCode = buffer.readUInt32BE(offset)
    offset += 4
  } else if ((flags & FLAGS_POSITIVE_SEQUENCE) !== 0 && buffer.length >= offset + 4) {
    offset += 4
  }

  if (buffer.length < offset + 4) return { type, errorCode, isLastPackage }
  const payloadSize = buffer.readUInt32BE(offset)
  offset += 4
  let payload = buffer.subarray(offset, offset + payloadSize)
  if (compression === 1 && payload.length) payload = gunzipSync(payload)
  if (serialization !== 1 || !payload.length) return { type, errorCode, isLastPackage }
  return {
    type,
    errorCode,
    isLastPackage,
    body: JSON.parse(payload.toString('utf8')) as AsrResponse,
  }
}

export async function testDoubaoConnection(settings: AppSettings): Promise<void> {
  let failure: Error | null = null
  const client = new DoubaoAsr(settings, {
    onPartial: () => undefined,
    onFinal: () => undefined,
    onSegmentEnd: () => undefined,
    onState: (state, message) => {
      if (state === 'error') failure = new Error(message || '豆包语音连接失败')
    },
  })
  try {
    await client.connect()
    await new Promise((resolve) => setTimeout(resolve, 800))
    if (failure) throw failure
  } finally {
    client.disconnect()
  }
}
