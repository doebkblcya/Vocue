export type AudioMode = 'system' | 'microphone'
export type ThemeMode = 'system' | 'light' | 'dark'
export type ThinkingEffort = 'disabled' | 'low' | 'high' | 'max'

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

export interface PreparationDocument {
  id: string
  preparationId: string
  filename: string
  kind: 'pdf' | 'markdown' | 'text'
  content: string
  position: number
  createdAt: string
}

export interface Preparation {
  id: string
  name: string
  jobDescription: string
  resume: string
  analysis: PreparationAnalysis | null
  systemPrompt: string
  createdAt: string
  updatedAt: string
  documents: PreparationDocument[]
}

export interface PreparationSummary {
  id: string
  name: string
  updatedAt: string
  documentCount: number
  analyzed: boolean
}

export interface PreparationAnalysis {
  overview: string
  keyRequirements: string[]
  candidateStrengths: string[]
  risks: string[]
  answerStrategy: string[]
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
  }
}

export interface ExtractedDocument {
  filename: string
  kind: PreparationDocument['kind']
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
      resume: string
      documents: ExtractedDocument[]
    }) => Promise<Preparation>
    remove: (id: string) => Promise<void>
    analyze: (id: string) => Promise<Preparation>
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
    sendMicrophoneAudio: (bytes: Uint8Array) => void
    onState: (callback: (state: InterviewSessionState) => void) => () => void
  }
  window: {
    openFloating: () => Promise<void>
    closeFloating: () => Promise<void>
    minimizeFloating: () => Promise<void>
    captureVisibilityPreview: () => Promise<VisibilityTestResult>
  }
}
