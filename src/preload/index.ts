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
      resume: string
      documents: ExtractedDocument[]
    }) => ipcRenderer.invoke('preparations:save', input),
    remove: (id: string) => ipcRenderer.invoke('preparations:remove', id),
    analyze: (id: string) => ipcRenderer.invoke('preparations:analyze', id),
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
    getState: () => ipcRenderer.invoke('session:get-state'),
    setMicrophoneActive: (active: boolean) =>
      ipcRenderer.invoke('session:set-microphone-active', active),
    sendMicrophoneAudio: (bytes: Uint8Array) =>
      ipcRenderer.send('session:microphone-audio', bytes),
    onState: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, state: Parameters<typeof callback>[0]): void =>
        callback(state)
      ipcRenderer.on('session:state', listener)
      return () => ipcRenderer.removeListener('session:state', listener)
    },
  },
  window: {
    openFloating: () => ipcRenderer.invoke('window:open-floating'),
    closeFloating: () => ipcRenderer.invoke('window:close-floating'),
    minimizeFloating: () => ipcRenderer.invoke('window:minimize-floating'),
    captureVisibilityPreview: () => ipcRenderer.invoke('window:capture-visibility-preview'),
  },
}

contextBridge.exposeInMainWorld('vocue', api)
