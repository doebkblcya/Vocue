import { ipcMain, nativeTheme, type WebContents } from 'electron'
import type { AppSettings, AudioMode, ExtractedDocument } from '../../shared/types'
import { toUserMessage } from '../../shared/error-message'
import { DeepSeekClient } from '../ai/deepseek-client'
import { buildAnalysisPrompt, buildInterviewSystemPrompt, parseAnalysis } from '../ai/prompt-builder'
import { testDoubaoConnection } from '../asr/doubao-asr'
import { extractDocument } from '../documents/extractor'
import { InterviewSession } from '../session/interview-session'
import { LocalDatabase } from '../storage/database'
import { SettingsStore } from '../storage/settings'
import {
  captureVisibilityPreview,
  broadcast,
  closeFloatingWindow,
  minimizeFloatingWindow,
  openFloatingWindow,
  setCaptureProtection,
  syncWindowThemeBackground,
} from '../windows'

function trustedSender(sender: WebContents): void {
  const url = sender.getURL()
  if (!url.startsWith('file://') && !url.startsWith('http://localhost:') && !url.startsWith('http://127.0.0.1:')) {
    throw new Error('拒绝未知页面的 IPC 请求')
  }
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
      if (!preparation.analysis || !preparation.systemPrompt) {
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
  handle('session:get-state', () => session.getState())
  handle('session:set-microphone-active', (_sender, active: boolean) =>
    session.setMicrophoneActive(active),
  )

  ipcMain.on('session:microphone-audio', (event, bytes: Uint8Array) => {
    trustedSender(event.sender)
    session.sendMicrophoneAudio(bytes)
  })

  handle('window:open-floating', () => openFloatingWindow())
  handle('window:close-floating', () => closeFloatingWindow())
  handle('window:minimize-floating', () => minimizeFloatingWindow())
  handle('window:capture-visibility-preview', () => captureVisibilityPreview())
}
