import { ipcMain, nativeTheme, type WebContents } from 'electron'
import type { AppSettings, AudioMode, ExtractedDocument } from '../../shared/types'
import { toUserMessage } from '../../shared/error-message'
import { DeepSeekClient } from '../ai/deepseek-client'
import { buildInterviewReviewPrompt } from '../ai/interview-review'
import { buildAnalysisPrompt, buildInterviewSystemPrompt, parseAnalysis } from '../ai/prompt-builder'
import { testDoubaoConnection } from '../asr/doubao-asr'
import { extractDocument } from '../documents/extractor'
import { InterviewSession } from '../session/interview-session'
import { planEchoCleanup } from '../session/echo-cleanup'
import { LocalDatabase } from '../storage/database'
import { SettingsStore } from '../storage/settings'
import {
  captureVisibilityPreview,
  captureQuestionScreenshot,
  broadcast,
  closeFloatingWindow,
  minimizeFloatingWindow,
  openFloatingWindow,
  setCaptureProtection,
  syncWindowThemeBackground,
} from '../windows'

function trustedSender(sender: WebContents): void {
  try {
    const senderUrl = new URL(sender.getURL())
    if (senderUrl.protocol === 'file:') return

    const rendererUrl = process.env.ELECTRON_RENDERER_URL
    if (rendererUrl && senderUrl.origin === new URL(rendererUrl).origin) return
  } catch {
    // 统一落到下面的拒绝分支
  }
  throw new Error('拒绝未知页面的 IPC 请求')
}

export function registerIpc(
  database: LocalDatabase,
  settings: SettingsStore,
  session: InterviewSession,
): void {
  const analyzePreparation = async (id: string) => {
    const preparation = database.getPreparation(id)
    if (!preparation) throw new Error('面试档案不存在')
    const text = await new DeepSeekClient(settings.get()).complete(
      [
        { role: 'system', content: '你是严谨的技术面试准备助手。' },
        { role: 'user', content: buildAnalysisPrompt(preparation) },
      ],
      { json: true },
    )
    const analysis = parseAnalysis(text)
    const prompt = buildInterviewSystemPrompt(preparation, analysis)
    return database.saveAnalysis(id, analysis, prompt)
  }

  const handle = <T extends unknown[], R>(
    channel: string,
    listener: (sender: WebContents, ...args: T) => R | Promise<R>,
  ): void => {
    ipcMain.handle(channel, (event, ...args: T) => {
      trustedSender(event.sender)
      return listener(event.sender, ...args)
    })
  }

  handle('settings:get', () => settings.getPublic())
  handle('settings:is-ready', () => settings.isReady())
  handle('settings:save', (_sender, input: Partial<AppSettings>) => {
    const saved = settings.save(input)
    setCaptureProtection(saved.hideFromScreenCapture)
    nativeTheme.themeSource = saved.theme
    syncWindowThemeBackground()
    broadcast('settings:changed', saved)
    return saved
  })
  handle('settings:test-deepseek', async () => {
    try {
      await new DeepSeekClient(settings.get()).test()
      return { ok: true, message: 'DeepSeek 连接成功' }
    } catch (error) {
      return { ok: false, message: DeepSeekClient.describeError(error) }
    }
  })
  handle('settings:test-doubao', async () => {
    try {
      await testDoubaoConnection(settings.get())
      return { ok: true, message: '豆包流式语音连接成功' }
    } catch (error) {
      return { ok: false, message: toUserMessage(error, '豆包语音连接失败，请检查网络和凭证') }
    }
  })

  handle('preparations:list', () => database.listPreparations())
  handle('preparations:get', (_sender, id: string) => database.getPreparation(id))
  handle(
    'preparations:save',
    (_sender, input: {
      id?: string
      name: string
      jobDescription: string
      resume: string
      documents: ExtractedDocument[]
    }) => {
      if (!input.name.trim()) throw new Error('请输入准备名称')
      if (input.documents.length > 5) throw new Error('补充资料最多 5 个文件')
      return database.savePreparation(input)
    },
  )
  handle('preparations:remove', (_sender, id: string) => database.removePreparation(id))
  handle('preparations:analyze', (_sender, id: string) => analyzePreparation(id))

  handle('documents:extract', (_sender, filename: string, bytes: Uint8Array) =>
    extractDocument(filename, bytes),
  )
  handle('documents:recognize-image', (_sender, filename: string, bytes: Uint8Array) => {
    if (bytes.byteLength > 10 * 1024 * 1024) throw new Error('图片不能超过 10 MB')
    const extension = filename.split('.').pop()?.toLowerCase()
    const mimeTypes: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
    }
    const mimeType = extension ? mimeTypes[extension] : undefined
    if (!mimeType) throw new Error('仅支持 PNG、JPEG 和 WebP 图片')
    return new DeepSeekClient(settings.get()).recognizeImage(bytes, mimeType)
  })

  handle('session:start', async (_sender, preparationId: string | null, mode: AudioMode) => {
    if (!settings.isReady()) throw new Error('请先完成 API 配置')
    if (preparationId) {
      const preparation = database.getPreparation(preparationId)
      if (!preparation) throw new Error('面试档案不存在')
      // systemPrompt 是兼容旧数据库的快照字段；运行时会用最新模板现算。
      // 因此只有缺少预分析时才需要发起昂贵的模型调用。
      if (!preparation.analysis) {
        await analyzePreparation(preparationId)
      }
    }
    try {
      await session.start(preparationId, mode)
      openFloatingWindow()
    } catch (error) {
      await session.stop()
      throw error
    }
  })
  handle('session:stop', () => session.stop())
  handle('session:reconnect', () => session.reconnect())
  handle('session:verify', () => session.verifyService())
  handle('session:ask-screenshot', async () => {
    if (session.getState().status === 'idle') throw new Error('请先开始一场面试')
    const screenshot = await captureQuestionScreenshot()
    session.answerScreenshot(screenshot.dataUrl, screenshot.displayName)
  })
  handle('session:get-state', () => session.getState())
  handle('session:set-microphone-active', (_sender, active: boolean) =>
    session.setMicrophoneActive(active),
  )
  handle('session:report-recording-problem', (_sender, message: string) =>
    session.reportRecordingProblem(message),
  )

  handle('interviews:list', () => database.listInterviewSessions())
  handle('interviews:get', (_sender, id: string) => database.getInterviewSession(id))
  handle('interviews:cleanup-echo', (_sender, id: string) => {
    const record = database.getInterviewSession(id)
    if (!record) throw new Error('面试记录不存在')
    if (record.status === 'recording') throw new Error('请先结束面试，再清理外放回声')
    return database.applyEchoCleanup(id, planEchoCleanup(record.utterances))
  })
  handle('interviews:undo-echo-cleanup', (_sender, id: string) =>
    database.undoEchoCleanup(id),
  )
  handle('interviews:generate-review', async (_sender, id: string) => {
    const record = database.getInterviewSession(id)
    if (!record) throw new Error('面试记录不存在')
    if (record.status === 'recording') throw new Error('请先结束面试，再生成复盘')
    if (!record.utterances.some((item) => !item.excludedAsEcho)) {
      throw new Error('这场面试没有可复盘的转写内容')
    }
    database.setInterviewReviewState(id, 'reviewing')
    try {
      const preparation = record.preparationId
        ? database.getPreparation(record.preparationId)
        : null
      const review = await new DeepSeekClient(settings.get()).complete(
        [
          { role: 'system', content: '你是严谨、具体的技术面试复盘教练。' },
          { role: 'user', content: buildInterviewReviewPrompt(record, preparation) },
        ],
        { thinkingEffort: 'high' },
      )
      database.setInterviewReviewState(
        id,
        record.status === 'incomplete' ? 'incomplete' : 'completed',
        review,
      )
    } catch (error) {
      database.setInterviewReviewState(
        id,
        record.status === 'incomplete' ? 'incomplete' : 'ready',
        record.reviewMarkdown,
        toUserMessage(error, '生成复盘失败，请重试'),
      )
      throw error
    }
    return database.getInterviewSession(id)
  })

  ipcMain.on('session:microphone-audio', (event, bytes: Uint8Array) => {
    trustedSender(event.sender)
    session.sendMicrophoneAudio(bytes)
  })

  handle('window:open-floating', () => openFloatingWindow())
  handle('window:close-floating', () => closeFloatingWindow())
  handle('window:minimize-floating', () => minimizeFloatingWindow())
  handle('window:capture-visibility-preview', () => {
    if (session.getState().status !== 'idle') {
      throw new Error('面试进行中不能执行录屏可见性自检，请先结束面试')
    }
    return captureVisibilityPreview()
  })
}
