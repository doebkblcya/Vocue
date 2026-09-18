import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings, AudioMode, ExtractedDocument, VocueApi } from '../shared/types'

const api: VocueApi = {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (settings: Partial<AppSettings>) => ipcRenderer.invoke('settings:save', settings),
    isReady: () => ipcRenderer.invoke('settings:is-ready'),
    testDeepseek: () => ipcRenderer.invoke('settings:test-deepseek'),
    testDoubao: () => ipcRenderer.invoke('settings:test-doubao'),
    onChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, settings: Parameters<typeof callback>[0]): void =>
        callback(settings)
      ipcRenderer.on('settings:changed', listener)
      return () => ipcRenderer.removeListener('settings:changed', listener)
    },
  },
  preparations: {
    list: () => ipcRenderer.invoke('preparations:list'),
    get: (id: string) => ipcRenderer.invoke('preparations:get', id),
    save: (input: {
      id?: string
      name: string
      jobDescription: string
      resumeDocumentId: string | null
      documentIds: string[]
    }) => ipcRenderer.invoke('preparations:save', input),
    remove: (id: string) => ipcRenderer.invoke('preparations:remove', id),
  },
  library: {
    list: () => ipcRenderer.invoke('library:list'),
    get: (id: string) => ipcRenderer.invoke('library:get', id),
    add: (document: ExtractedDocument) => ipcRenderer.invoke('library:add', document),
    rename: (id: string, filename: string) => ipcRenderer.invoke('library:rename', id, filename),
    remove: (id: string) => ipcRenderer.invoke('library:remove', id),
  },
  documents: {
    extract: (filename: string, bytes: Uint8Array) =>
      ipcRenderer.invoke('documents:extract', filename, bytes),
    recognizeImage: (filename: string, bytes: Uint8Array) =>
      ipcRenderer.invoke('documents:recognize-image', filename, bytes),
  },
  session: {
    start: (preparationId: string | null, mode: AudioMode) =>
      ipcRenderer.invoke('session:start', preparationId, mode),
    stop: () => ipcRenderer.invoke('session:stop'),
    reconnect: () => ipcRenderer.invoke('session:reconnect'),
    verify: () => ipcRenderer.invoke('session:verify'),
    askScreenshot: () => ipcRenderer.invoke('session:ask-screenshot'),
    getState: () => ipcRenderer.invoke('session:get-state'),
    setMicrophoneActive: (active: boolean) =>
      ipcRenderer.invoke('session:set-microphone-active', active),
    reportRecordingProblem: (message: string) =>
      ipcRenderer.invoke('session:report-recording-problem', message),
    sendMicrophoneAudio: (bytes: Uint8Array) =>
      ipcRenderer.send('session:microphone-audio', bytes),
    onState: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, state: Parameters<typeof callback>[0]): void =>
        callback(state)
      ipcRenderer.on('session:state', listener)
      return () => ipcRenderer.removeListener('session:state', listener)
    },
  },
  interviews: {
    list: () => ipcRenderer.invoke('interviews:list'),
    get: (id: string) => ipcRenderer.invoke('interviews:get', id),
    cleanupEcho: (id: string) => ipcRenderer.invoke('interviews:cleanup-echo', id),
    undoEchoCleanup: (id: string) => ipcRenderer.invoke('interviews:undo-echo-cleanup', id),
    generateReview: (id: string) => ipcRenderer.invoke('interviews:generate-review', id),
  },
  window: {
    openFloating: () => ipcRenderer.invoke('window:open-floating'),
    closeFloating: () => ipcRenderer.invoke('window:close-floating'),
    minimizeFloating: () => ipcRenderer.invoke('window:minimize-floating'),
    captureVisibilityPreview: () => ipcRenderer.invoke('window:capture-visibility-preview'),
  },
}

contextBridge.exposeInMainWorld('vocue', api)
