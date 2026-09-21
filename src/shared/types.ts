import type { InterviewStage } from './stage'
import type { RecordingIssue } from './recording-issue'

export type AudioMode = 'system' | 'microphone'
export type ThemeMode = 'system' | 'light' | 'dark'
export type ThinkingEffort = 'disabled' | 'low' | 'high' | 'max'
export type DocumentKind = 'pdf' | 'markdown' | 'text'

export type { InterviewStage }

export interface AppSettings {
  deepseekApiKey: string
  doubaoApiKey: string
  hideFromScreenCapture: boolean
  theme: ThemeMode
  thinkingEffort: ThinkingEffort
}

export interface PublicSettings {
  hasDeepseekApiKey: boolean
  hasDoubaoApiKey: boolean
  hideFromScreenCapture: boolean
  theme: ThemeMode
  thinkingEffort: ThinkingEffort
}

export interface CapturePreview {
  id: string
  name: string
  dataUrl: string
}

export interface VisibilityTestResult {
  unprotected: CapturePreview[]
  protected: CapturePreview[]
}

/** 文档库分两类：简历是给档案当「我的简历」用的，文档是补充资料 */
export type LibraryCategory = 'resume' | 'document'

/** 文档库里的文档：全应用只存一份，档案按 id 引用它 */
export interface LibraryDocument {
  id: string
  filename: string
  kind: DocumentKind
  category: LibraryCategory
  content: string
  createdAt: string
  updatedAt: string
}

/** 列表用：不带正文，只带字数，便于界面显示上限占用情况 */
export interface LibraryDocumentSummary {
  id: string
  filename: string
  kind: DocumentKind
  category: LibraryCategory
  updatedAt: string
  /** 全文长度 */
  totalChars: number
}

/** 档案对库文档的引用。filename / content 由库解析后带出，方便直接使用 */
export interface PreparationDocument {
  id: string
  preparationId: string
  libraryDocumentId: string
  filename: string
  kind: DocumentKind
  content: string
  position: number
  createdAt: string
}

export interface Preparation {
  id: string
  name: string
  jobDescription: string
  /** 面到第几轮了；null 表示还没定 */
  stage: InterviewStage
  /** 从文档库选中的简历；未选择时为 null */
  resume: LibraryDocument | null
  createdAt: string
  updatedAt: string
  documents: PreparationDocument[]
}

export interface PreparationSummary {
  id: string
  name: string
  stage: InterviewStage
  updatedAt: string
  documentCount: number
  hasResume: boolean
}

/**
 * 会话状态只描述「语音链路」：
 * 连接、检测、录音、收尾、断线、错误。
 * AI 是否正在生成回答不属于这里，见 InterviewSessionState.generating。
 */
export type SessionStatus =
  | 'idle'
  | 'connecting'
  | 'verifying'
  | 'ready'
  | 'listening'
  | 'recording'
  | 'finalizing'
  | 'reconnecting'
  | 'error'

export interface InterviewSessionState {
  status: SessionStatus
  mode: AudioMode | null
  preparationId: string | null
  preparationName: string
  partialTranscript: string
  finalTranscript: string
  answer: string
  answerSummary: string
  answerDetail: string
  error: string
  microphoneActive: boolean
  /** AI 是否正在生成回答。属于模型侧，不属于语音服务状态。 */
  generating: boolean
  /** 系统音频模式会同时转写麦克风，并把双方终稿保存为面试记录。 */
  recordingTranscript: boolean
  recordId: string | null
}

/**
 * 一条已经生成的回答，供悬浮窗回看。
 *
 * 刻意**不放进** InterviewSessionState：state 在流式生成时每来一小段就会
 * 广播一次，把整份历史挂上去等于每秒重发几十遍。这个列表只在一条回答
 * 真正完成时才变，所以走自己的事件，走自己的通道。
 */
export interface AnswerLogEntry {
  question: string
  answer: string
  summary: string
  detail: string
}

/** 手机伴侣只接收展示所需字段，避免以后给会话状态新增内部字段时被意外暴露。 */
export interface CompanionSessionState {
  status: SessionStatus
  mode: AudioMode | null
  preparationName: string
  partialTranscript: string
  finalTranscript: string
  answerSummary: string
  answerDetail: string
  error: string
  generating: boolean
}

export interface CompanionAnswerEntry {
  question: string
  summary: string
  detail: string
}

/** 桌面端开始弹窗里展示的局域网伴侣连接状态。 */
export interface CompanionConnectionState {
  active: boolean
  url: string
  qrDataUrl: string
  connectedClients: number
}

export function createInitialInterviewSessionState(): InterviewSessionState {
  return {
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
  }
}

export type InterviewRole = 'interviewer' | 'candidate'
export type InterviewRecordStatus = 'recording' | 'ready' | 'reviewing' | 'completed' | 'incomplete'

export interface InterviewUtterance {
  id: string
  sessionId: string
  sequence: number
  role: InterviewRole
  text: string
  /** 外放回声清理后的展示文本；null 表示没有修改。原文始终保留在 text。 */
  cleanedText: string | null
  excludedAsEcho: boolean
  startMs: number
  endMs: number
  createdAt: string
}

export interface InterviewRecordSummary {
  id: string
  preparationId: string | null
  preparationName: string
  /**
   * 面试开始那一刻档案是第几面；null 表示当时无从知道——
   * 通用面试（没有档案），或这一列出现之前建的老记录。
   *
   * 建记录时抄下来，之后不再跟着档案变：你可以把档案推进到下一面，
   * 而这条记录仍然是当时那一面。理由和 preparationName 一样，
   * 记录是存档，不该被后来的操作改写。
   */
  stage: InterviewStage
  status: InterviewRecordStatus
  /** 只有 status 为 incomplete 时有意义；老记录为 null */
  incompleteReason: RecordingIssue | null
  startedAt: string
  endedAt: string | null
  durationMs: number
  utteranceCount: number
  hasReview: boolean
  echoCleanupApplied: boolean
  echoRemovedCount: number
  echoChangedCount: number
}

export interface InterviewRecord extends InterviewRecordSummary {
  reviewMarkdown: string
  reviewError: string
  utterances: InterviewUtterance[]
}

export interface InterviewExportResult {
  /** 用户在保存对话框里点了取消时为 false */
  saved: boolean
  path?: string
}

export interface ExtractedDocument {
  filename: string
  kind: DocumentKind
  content: string
}

export interface VocueApi {
  settings: {
    get: () => Promise<PublicSettings>
    save: (settings: Partial<AppSettings>) => Promise<PublicSettings>
    isReady: () => Promise<boolean>
    testDeepseek: () => Promise<{ ok: boolean; message: string }>
    testDoubao: () => Promise<{ ok: boolean; message: string }>
    onChanged: (callback: (settings: PublicSettings) => void) => () => void
  }
  preparations: {
    list: () => Promise<PreparationSummary[]>
    get: (id: string) => Promise<Preparation | null>
    save: (input: {
      id?: string
      name: string
      jobDescription: string
      stage: InterviewStage
      resumeDocumentId: string | null
      documentIds: string[]
    }) => Promise<Preparation>
    /** 只改面试阶段：档案卡上「进入下一面」用的轻量入口 */
    setStage: (id: string, stage: InterviewStage) => Promise<PreparationSummary>
    remove: (id: string) => Promise<void>
  }
  library: {
    list: () => Promise<LibraryDocumentSummary[]>
    get: (id: string) => Promise<LibraryDocument | null>
    add: (document: ExtractedDocument, category: LibraryCategory) => Promise<LibraryDocument>
    rename: (id: string, filename: string) => Promise<LibraryDocument>
    remove: (id: string) => Promise<void>
  }
  documents: {
    extract: (filename: string, bytes: Uint8Array) => Promise<ExtractedDocument>
    recognizeImage: (filename: string, bytes: Uint8Array) => Promise<string>
  }
  session: {
    start: (preparationId: string | null, mode: AudioMode) => Promise<void>
    stop: () => Promise<void>
    reconnect: () => Promise<void>
    verify: () => Promise<void>
    askScreenshot: () => Promise<void>
    getState: () => Promise<InterviewSessionState>
    setMicrophoneActive: (active: boolean) => Promise<void>
    reportRecordingProblem: (message: string) => Promise<void>
    sendMicrophoneAudio: (bytes: Uint8Array) => void
    onState: (callback: (state: InterviewSessionState) => void) => () => void
    onAnswerLog: (callback: (entries: AnswerLogEntry[]) => void) => () => void
  }
  companion: {
    start: () => Promise<CompanionConnectionState>
    stop: () => Promise<CompanionConnectionState>
    getState: () => Promise<CompanionConnectionState>
    copyUrl: () => Promise<void>
    onState: (callback: (state: CompanionConnectionState) => void) => () => void
  }
  interviews: {
    list: () => Promise<InterviewRecordSummary[]>
    get: (id: string) => Promise<InterviewRecord | null>
    cleanupEcho: (id: string) => Promise<InterviewRecord>
    undoEchoCleanup: (id: string) => Promise<InterviewRecord>
    generateReview: (id: string) => Promise<InterviewRecord>
    /** 弹出保存对话框，把转写原样写成 Markdown 文件 */
    export: (id: string) => Promise<InterviewExportResult>
    /** 把同一份 Markdown 写进系统剪贴板 */
    copy: (id: string) => Promise<void>
    remove: (id: string) => Promise<void>
  }
  window: {
    openFloating: () => Promise<void>
    closeFloating: () => Promise<void>
    minimizeFloating: () => Promise<void>
    captureVisibilityPreview: () => Promise<VisibilityTestResult>
  }
}
