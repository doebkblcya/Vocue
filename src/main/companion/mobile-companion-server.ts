import { randomBytes, timingSafeEqual } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { createServer, type Server } from 'node:http'
import { networkInterfaces } from 'node:os'
import QRCode from 'qrcode'
import WebSocket, { WebSocketServer } from 'ws'
import type {
  AnswerLogEntry,
  CompanionAnswerEntry,
  CompanionConnectionState,
  CompanionSessionState,
  InterviewSessionState,
} from '../../shared/types'
import { companionPageHtml } from './page'

export class MobileCompanionServer extends EventEmitter<{
  state: [CompanionConnectionState]
}> {
  private server: Server | null = null
  private webSocketServer: WebSocketServer | null = null
  private sockets = new Set<WebSocket>()
  private token = ''
  private url = ''
  private qrDataUrl = ''
  private latestState: CompanionSessionState = toCompanionState({
    status: 'idle',
    mode: null,
    preparationId: null,
    preparationName: '',
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
  private latestAnswers: CompanionAnswerEntry[] = []

  getState(): CompanionConnectionState {
    return {
      active: this.server !== null,
      url: this.url,
      qrDataUrl: this.qrDataUrl,
      connectedClients: this.sockets.size,
    }
  }

  async start(): Promise<CompanionConnectionState> {
    if (this.server) return this.getState()
    const address = findLanAddress()
    if (!address) throw new Error('没有找到可用的局域网地址，请先连接 Wi-Fi')

    this.token = randomBytes(24).toString('base64url')
    const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: 1024 })
    const server = createServer((request, response) => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname
      if (request.method !== 'GET' || path !== '/') {
        response.writeHead(404, securityHeaders('text/plain; charset=utf-8'))
        response.end('Not found')
        return
      }
      response.writeHead(200, securityHeaders('text/html; charset=utf-8'))
      response.end(companionPageHtml)
    })

    server.on('upgrade', (request, socket, head) => {
      const requestUrl = new URL(request.url ?? '/', 'http://localhost')
      const suppliedToken = requestUrl.searchParams.get('token') ?? ''
      if (requestUrl.pathname !== '/ws' || !sameToken(suppliedToken, this.token)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
      }
      webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        webSocketServer.emit('connection', webSocket, request)
      })
    })

    webSocketServer.on('connection', (socket) => {
      this.sockets.add(socket)
      socket.send(JSON.stringify({
        type: 'snapshot',
        state: this.latestState,
        answers: this.latestAnswers,
      }))
      this.emitState()
      socket.on('close', () => {
        this.sockets.delete(socket)
        this.emitState()
      })
      // 伴侣通道严格只读，手机发送任何业务消息都直接断开。
      socket.on('message', () => socket.close(1008, 'read-only'))
      socket.on('error', () => socket.close())
    })

    try {
      await listen(server)
      const bound = server.address()
      if (!bound || typeof bound === 'string') throw new Error('无法读取手机伴侣服务端口')
      this.url = `http://${address}:${bound.port}/#${this.token}`
      this.qrDataUrl = await QRCode.toDataURL(this.url, {
        width: 240,
        margin: 1,
        errorCorrectionLevel: 'M',
      })
      this.server = server
      this.webSocketServer = webSocketServer
      this.emitState()
      return this.getState()
    } catch (error) {
      webSocketServer.close()
      server.close()
      this.token = ''
      this.url = ''
      this.qrDataUrl = ''
      throw error
    }
  }

  publishState(state: InterviewSessionState): void {
    this.latestState = toCompanionState(state)
    this.broadcast({ type: 'state', state: this.latestState })
  }

  publishAnswers(entries: AnswerLogEntry[]): void {
    this.latestAnswers = entries.map(({ question, summary, detail }) => ({ question, summary, detail }))
    this.broadcast({ type: 'answers', answers: this.latestAnswers })
  }

  async stop(reason: 'closed' | 'ended' = 'closed'): Promise<CompanionConnectionState> {
    const server = this.server
    if (!server) return this.getState()
    const webSocketServer = this.webSocketServer

    this.broadcast({ type: reason })
    this.server = null
    this.webSocketServer = null
    this.token = ''
    this.url = ''
    this.qrDataUrl = ''
    // 退出应用时不能依赖手机完成 WebSocket 关闭握手；直接终止，避免 server.close()
    // 因一台离线或休眠的手机无限等待。
    for (const socket of this.sockets) socket.terminate()
    this.sockets.clear()
    await Promise.all([close(server), closeWebSocketServer(webSocketServer)])
    this.emitState()
    return this.getState()
  }

  private broadcast(message: unknown): void {
    const payload = JSON.stringify(message)
    for (const socket of this.sockets) {
      if (socket.readyState === WebSocket.OPEN) socket.send(payload)
    }
  }

  private emitState(): void {
    this.emit('state', this.getState())
  }
}

function toCompanionState(state: InterviewSessionState): CompanionSessionState {
  return {
    status: state.status,
    mode: state.mode,
    preparationName: state.preparationName,
    partialTranscript: state.partialTranscript,
    finalTranscript: state.finalTranscript,
    answerSummary: state.answerSummary,
    answerDetail: state.answerDetail,
    error: state.error,
    generating: state.generating,
  }
}

function securityHeaders(contentType: string): Record<string, string> {
  return {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src ws:; img-src data:",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  }
}

function sameToken(received: string, expected: string): boolean {
  if (!received || !expected) return false
  const receivedBytes = Buffer.from(received)
  const expectedBytes = Buffer.from(expected)
  return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes)
}

function findLanAddress(): string | null {
  const candidates = Object.entries(networkInterfaces()).flatMap(([name, addresses]) =>
    (addresses ?? [])
      .filter((address) => address.family === 'IPv4' && !address.internal && isPrivateIpv4(address.address))
      .map((address) => ({ name, address: address.address })),
  )
  candidates.sort((left, right) => interfacePriority(left.name) - interfacePriority(right.name))
  return candidates[0]?.address ?? null
}

function interfacePriority(name: string): number {
  if (name === 'en0') return 0
  if (name === 'en1') return 1
  if (name.startsWith('en')) return 2
  if (name.startsWith('bridge')) return 4
  return 3
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map(Number)
  return parts[0] === 10
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    const failed = (error: Error): void => reject(error)
    server.once('error', failed)
    server.listen(0, '0.0.0.0', () => {
      server.off('error', failed)
      resolve()
    })
  })
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve())
    server.closeAllConnections()
  })
}

function closeWebSocketServer(server: WebSocketServer | null): Promise<void> {
  if (!server) return Promise.resolve()
  return new Promise((resolve) => server.close(() => resolve()))
}
